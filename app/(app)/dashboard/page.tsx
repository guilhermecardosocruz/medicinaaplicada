export default function DashboardPage() {
  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="text-xl font-semibold">Dashboard</h1>
      <p className="mt-2 text-sm text-muted">
        Aqui vai aparecer a fila de pacientes (cards) e o botão para atender o próximo.
      </p>

      <div className="mt-6 surface p-4">
        <div className="text-sm font-semibold">Fila (MVP)</div>
        <div className="mt-2 text-sm text-muted">
          Em breve: cards de pacientes gerados por IA no momento em que você clicar em “Atender”.
        </div>
      </div>
    </main>
  );
}
