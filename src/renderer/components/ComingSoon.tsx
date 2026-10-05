import { Clock } from 'lucide-react'
import { EmptyState } from './ui'

export function ComingSoon({ title, reason }: { title: string; reason: string }) {
  return (
    <div className="p-6">
      <h1 className="mb-4 text-lg font-semibold">{title}</h1>
      <EmptyState icon={<Clock size={28} />} title="Ainda não disponível" body={reason} />
    </div>
  )
}
