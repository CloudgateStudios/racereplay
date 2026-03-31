import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

/**
 * GET /api/admin/races/:id
 *
 * Returns race metadata for the admin import page.
 * Auth enforced by middleware.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await params

  const race = await prisma.race.findUnique({ where: { id } })

  if (!race) {
    return NextResponse.json({ error: 'Race not found' }, { status: 404 })
  }

  return NextResponse.json({
    race: {
      id: race.id,
      slug: race.slug,
      name: race.name,
      location: race.location,
      date: race.date instanceof Date ? race.date.toISOString().slice(0, 10) : String(race.date).slice(0, 10),
      distance: race.distance,
      passingMode: race.passingMode,
    },
  })
}
