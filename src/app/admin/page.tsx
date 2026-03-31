import { prisma } from '@/lib/prisma'
import Link from 'next/link'
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { LogoutButton } from './logout-button'

export default async function AdminDashboardPage() {
  const races = await prisma.race.findMany({
    orderBy: { date: 'desc' },
    include: {
      _count: {
        select: { athletes: true },
      },
    },
  })

  return (
    <div className="min-h-screen p-4 sm:p-8">
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-8 gap-4">
          <div>
            <h1 className="text-3xl font-bold">RaceReplay Admin</h1>
            <p className="text-muted-foreground mt-1">Manage races and imports</p>
          </div>
          <div className="flex gap-3">
            <Link href="/admin/races/new">
              <Button>New Race</Button>
            </Link>
            <LogoutButton />
          </div>
        </div>

        {races.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <p>No races yet.</p>
            <p className="mt-2">
              <Link href="/admin/races/new" className="text-primary underline">
                Create your first race
              </Link>{' '}
              to get started.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Distance</TableHead>
                <TableHead>Athletes</TableHead>
                <TableHead>Passing Mode</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {races.map((race) => (
                <TableRow key={race.id}>
                  <TableCell className="font-medium">{race.name}</TableCell>
                  <TableCell>
                    {race.date instanceof Date
                      ? race.date.toISOString().slice(0, 10)
                      : String(race.date).slice(0, 10)}
                  </TableCell>
                  <TableCell>{race.distance}</TableCell>
                  <TableCell>{race._count.athletes}</TableCell>
                  <TableCell>{race.passingMode}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex gap-2 justify-end">
                      <Link href={`/admin/races/${race.id}/import`}>
                        <Button size="sm" variant="outline">
                          Import
                        </Button>
                      </Link>
                      <Link href={`/${race.slug}`} target="_blank" rel="noopener noreferrer">
                        <Button size="sm" variant="ghost">
                          View
                        </Button>
                      </Link>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          </div>
        )}
      </div>
    </div>
  )
}
