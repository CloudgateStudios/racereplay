import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

/**
 * POST /api/admin/races
 *
 * Create a new race record. Auth enforced by middleware.
 *
 * Validates:
 * - slug matches ^[a-z0-9-]+$
 * - date is a valid ISO date string
 * - distance is FULL or HALF
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: {
    slug?: unknown
    name?: unknown
    location?: unknown
    date?: unknown
    distance?: unknown
  }

  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { slug, name, location, date, distance } = body

  // Validate required fields
  if (!slug || typeof slug !== 'string') {
    return NextResponse.json({ error: 'slug is required' }, { status: 400 })
  }
  if (!name || typeof name !== 'string') {
    return NextResponse.json({ error: 'name is required' }, { status: 400 })
  }
  if (!location || typeof location !== 'string') {
    return NextResponse.json({ error: 'location is required' }, { status: 400 })
  }
  if (!date || typeof date !== 'string') {
    return NextResponse.json({ error: 'date is required' }, { status: 400 })
  }
  if (!distance || typeof distance !== 'string') {
    return NextResponse.json({ error: 'distance is required' }, { status: 400 })
  }

  // Validate slug format
  if (!/^[a-z0-9-]+$/.test(slug)) {
    return NextResponse.json(
      { error: 'slug must match ^[a-z0-9-]+$ (lowercase letters, numbers, hyphens only)' },
      { status: 400 }
    )
  }

  // Validate date
  const parsedDate = new Date(date)
  if (isNaN(parsedDate.getTime())) {
    return NextResponse.json({ error: 'date must be a valid ISO date string' }, { status: 400 })
  }

  // Validate distance
  if (distance !== 'FULL' && distance !== 'HALF') {
    return NextResponse.json({ error: 'distance must be FULL or HALF' }, { status: 400 })
  }

  // Create the race
  try {
    const race = await prisma.race.create({
      data: {
        slug: slug.trim(),
        name: name.trim(),
        location: location.trim(),
        date: parsedDate,
        distance: distance as 'FULL' | 'HALF',
      },
    })

    return NextResponse.json(
      {
        race: {
          id: race.id,
          slug: race.slug,
          name: race.name,
          location: race.location,
          date: race.date.toISOString().slice(0, 10),
          distance: race.distance,
          passingMode: race.passingMode,
          createdAt: race.createdAt.toISOString(),
        },
      },
      { status: 201 }
    )
  } catch (err: unknown) {
    // Unique constraint violation = slug already exists
    const pgErr = err as { code?: string }
    if (pgErr?.code === 'P2002') {
      return NextResponse.json({ error: 'A race with this slug already exists' }, { status: 409 })
    }
    throw err
  }
}

/**
 * GET /api/admin/races/:id
 * (Dynamic segment handled separately — this route handles collection-level requests)
 */
