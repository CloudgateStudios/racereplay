import { NextRequest, NextResponse } from 'next/server'

/**
 * src/middleware.ts
 *
 * Centrally enforces session auth on all admin routes.
 * Runs in Node.js runtime (not Edge) to allow DB access via fetch to internal route.
 *
 * Excluded: /admin/login (the login page itself)
 * Special: /api/admin/session POST — rate limiting enforced here
 *
 * For all other /admin/* and /api/admin/*:
 * - Reads admin_session cookie
 * - Calls internal GET /api/admin/session/check to validate
 * - Pages: redirect to /admin/login on failure
 * - API routes: return 401 on failure
 *
 * Audit log format:
 *   [admin] METHOD /path — auth=ok|fail ip=X ts=Y
 * The ADMIN_SECRET and session tokens are never logged.
 */

// Rate limiter for failed login attempts on POST /api/admin/session
// Map: ip → { count: number, resetAt: number (ms epoch) }
export const loginFailures = new Map<string, { count: number; resetAt: number }>()

const RATE_LIMIT_MAX = 5
const RATE_LIMIT_WINDOW_MS = 60 * 1000 // 1 minute

export function checkRateLimit(ip: string): boolean {
  const now = Date.now()
  const entry = loginFailures.get(ip)

  if (!entry || now >= entry.resetAt) {
    // No entry or window expired — not rate limited
    return false
  }

  return entry.count >= RATE_LIMIT_MAX
}

export function recordLoginFailure(ip: string): void {
  const now = Date.now()
  const entry = loginFailures.get(ip)

  if (!entry || now >= entry.resetAt) {
    loginFailures.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS })
  } else {
    entry.count++
  }
}

export function clearLoginFailures(ip: string): void {
  loginFailures.delete(ip)
}

function getIp(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    'unknown'
  )
}

function isPageRoute(pathname: string): boolean {
  return !pathname.startsWith('/api/')
}

export async function middleware(req: NextRequest): Promise<NextResponse> {
  const { pathname } = req.nextUrl
  const method = req.method
  const ip = getIp(req)
  const ts = new Date().toISOString()

  // ── /admin/login: always allow ─────────────────────────────────────────────
  if (pathname === '/admin/login') {
    return NextResponse.next()
  }

  // ── POST /api/admin/session: apply rate limiting, then pass through ─────────
  if (pathname === '/api/admin/session' && method === 'POST') {
    if (checkRateLimit(ip)) {
      console.log(`[admin] ${method} ${pathname} — auth=ratelimited ip=${ip} ts=${ts}`)
      return NextResponse.json(
        { error: 'Too many failed login attempts. Try again in a minute.' },
        { status: 429 }
      )
    }
    // Pass through to the session route handler which does its own logic
    return NextResponse.next()
  }

  // ── DELETE /api/admin/session (logout): pass through (no auth required to logout) ──
  if (pathname === '/api/admin/session' && method === 'DELETE') {
    return NextResponse.next()
  }

  // ── All other admin routes: validate session ───────────────────────────────
  const token = req.cookies.get('admin_session')?.value

  if (!token) {
    console.log(`[admin] ${method} ${pathname} — auth=fail ip=${ip} ts=${ts}`)
    if (isPageRoute(pathname)) {
      return NextResponse.redirect(new URL('/admin/login', req.url))
    }
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Validate session via internal API route
  try {
    const checkUrl = new URL('/api/admin/session/check', req.url)
    const checkRes = await fetch(checkUrl.toString(), {
      headers: {
        cookie: `admin_session=${token}`,
      },
    })

    if (checkRes.ok) {
      console.log(`[admin] ${method} ${pathname} — auth=ok ip=${ip} ts=${ts}`)
      return NextResponse.next()
    }
  } catch {
    // Fall through to auth=fail
  }

  console.log(`[admin] ${method} ${pathname} — auth=fail ip=${ip} ts=${ts}`)

  if (isPageRoute(pathname)) {
    return NextResponse.redirect(new URL('/admin/login', req.url))
  }
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}

export const config = {
  matcher: ['/admin/:path*', '/api/admin/:path*'],
}
