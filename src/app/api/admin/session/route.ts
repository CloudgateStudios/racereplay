import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkRateLimit, recordLoginFailure, clearLoginFailures } from '@/middleware'

const SESSION_DURATION_MS = 4 * 60 * 60 * 1000 // 4 hours

function getIp(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    'unknown'
  )
}

/**
 * POST /api/admin/session
 *
 * Authenticate with the ADMIN_SECRET and create a session.
 * Sets an httpOnly, Secure, SameSite=Strict cookie on success.
 *
 * Rate limited: 5 failed attempts per IP per minute (enforced by middleware,
 * but also checked here for defense in depth).
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const ip = getIp(req)
  const ts = new Date().toISOString()

  // Check rate limit (middleware already checked, but double-check here)
  if (checkRateLimit(ip)) {
    return NextResponse.json(
      { error: 'Too many failed login attempts. Try again in a minute.' },
      { status: 429 }
    )
  }

  let body: { secret?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { secret } = body
  const adminSecret = process.env.ADMIN_SECRET

  if (!adminSecret) {
    console.error('[admin] ADMIN_SECRET environment variable is not set')
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 })
  }

  if (typeof secret !== 'string' || secret !== adminSecret) {
    recordLoginFailure(ip)
    console.log(`[admin] POST /api/admin/session — auth=fail ip=${ip} ts=${ts}`)
    return NextResponse.json({ error: 'Incorrect password' }, { status: 401 })
  }

  // Login successful — clear failure count, create session
  clearLoginFailures(ip)

  const token = crypto.randomUUID()
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS)

  await prisma.adminSession.upsert({
    where: { id: 'singleton' },
    update: { token, expiresAt },
    create: { id: 'singleton', token, expiresAt },
  })

  console.log(`[admin] POST /api/admin/session — auth=ok ip=${ip} ts=${ts}`)

  const res = NextResponse.json({ ok: true })
  res.cookies.set('admin_session', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: SESSION_DURATION_MS / 1000, // seconds
    path: '/',
  })

  return res
}

/**
 * DELETE /api/admin/session
 *
 * Logout: deletes the AdminSession singleton row and clears the cookie.
 */
export async function DELETE(): Promise<NextResponse> {
  try {
    await prisma.adminSession.delete({
      where: { id: 'singleton' },
    })
  } catch {
    // Row may not exist — that's fine
  }

  const res = NextResponse.json({ ok: true })
  res.cookies.set('admin_session', '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 0,
    path: '/',
  })

  return res
}
