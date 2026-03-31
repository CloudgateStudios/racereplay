import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

/**
 * GET /api/admin/session/check
 *
 * Internal route used by middleware to validate the admin session cookie.
 * Reads the `admin_session` cookie, queries AdminSession WHERE token matches
 * and expiresAt > now. Returns 200 if valid, 401 if not.
 *
 * Not intended for public use — called only by src/middleware.ts.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const token = req.cookies.get('admin_session')?.value

  if (!token) {
    return NextResponse.json({ ok: false }, { status: 401 })
  }

  try {
    const session = await prisma.adminSession.findFirst({
      where: {
        id: 'singleton',
        token,
        expiresAt: { gt: new Date() },
      },
    })

    if (!session) {
      return NextResponse.json({ ok: false }, { status: 401 })
    }

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ ok: false }, { status: 401 })
  }
}
