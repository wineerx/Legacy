import { readFileSync, writeFileSync, existsSync } from 'node:fs'

const read=name=>JSON.parse(readFileSync(`docs/benchmarks/${name}.json`,'utf8'))
const before=read('before'),after=read('after'),capacity=read('account-capacity'),storage=existsSync('docs/benchmarks/storage.json')?read('storage'):null
const num=n=>Number(n).toFixed(2),mb=n=>num(n/1048576),diff=(a,b)=>`${num(b-a)} (${num((b/a-1)*100)}%)`
const eager=after.receipt.find(r=>r.strategy==='eager-replay'),jit=after.receipt.find(r=>r.strategy==='jit')
const table=(headers,rows)=>`| ${headers.join(' | ')} |\n| ${headers.map(()=> '---').join(' | ')} |\n${rows.map(r=>`| ${r.join(' | ')} |`).join('\n')}`
function sampledResources(phase) {
  const samples=after.ffmpegSamples.filter(s=>s.timestamp>=phase.startedAt && s.timestamp<=phase.finishedAt)
  const seen=new Map();let peakRss=0,peakCpuPercent=0,previousTime
  for(const s of samples) {
    let deltaCpu=0,rss=0
    for(const p of s.processes) {
      const previous=seen.get(p.id);deltaCpu+=Math.max(0,p.cpuMs-(previous?.cpuMs??0));rss+=p.rssBytes
      seen.set(p.id,{cpuMs:p.cpuMs,readBytes:Math.max(p.readBytes,previous?.readBytes??0),writeBytes:Math.max(p.writeBytes,previous?.writeBytes??0)})
    }
    peakRss=Math.max(peakRss,rss)
    if(previousTime)peakCpuPercent=Math.max(peakCpuPercent,deltaCpu/(s.timestamp-previousTime)/after.hardware.logicalCpus*100)
    previousTime=s.timestamp
  }
  return {samples:samples.length,peakRss,peakCpuPercent,readBytes:[...seen.values()].reduce((s,p)=>s+p.readBytes,0),writeBytes:[...seen.values()].reduce((s,p)=>s+p.writeBytes,0)}
}
const ffRows=after.media.map(m=>{
  const r=sampledResources(m)
  return [m.concurrency,num(m.ffmpegMs.p50),num(m.ffmpegMs.p90),num(m.ffmpegMs.p95),num(m.ffmpegMs.p99),num(m.ffmpegMs.max),num(m.ratio.p50),num(m.elapsedMs),`${mb(r.peakRss)} MB`,`${num(r.peakCpuPercent)}%`,`${mb(r.readBytes)}/${mb(r.writeBytes)} MB`,r.samples]
})
const sameQueue=after.queue.map(a=>{const b=before.queue.find(b=>b.n===a.n&&b.accounts===a.accounts);return[a.n,a.accounts,num(b.enqueueMs),num(a.enqueueMs),num(b.claimMs.p95),num(a.claimMs.p95),num(b.queueLagMs.p95),num(a.queueLagMs.p95)]})
const metrics=[
 ['40 intenções: recibo (replay do caminho antigo × JIT)',`${num(eager.schedulingMs)} ms`,`${num(jit.schedulingMs)} ms`,diff(eager.schedulingMs,jit.schedulingMs)],
 ['Edições executadas antes do horário',eager.editedImmediately,jit.editedImmediately,jit.editedImmediately-eager.editedImmediately],
 ['Preprocessing antecipado de 40 (replay × JIT)',`${num(eager.backgroundPreprocessMs)} ms`,`${num(jit.backgroundPreprocessMs)} ms`,diff(eager.backgroundPreprocessMs,jit.backgroundPreprocessMs)],
 ['40 jobs com polling mock 30 ms: total',`${num(before.provider.elapsedMs)} ms`,`${num(after.provider.elapsedMs)} ms`,diff(before.provider.elapsedMs,after.provider.elapsedMs)],
 ['40 jobs mock: latência de conclusão p95',`${num(before.provider.completionMs.p95)} ms`,`${num(after.provider.completionMs.p95)} ms`,diff(before.provider.completionMs.p95,after.provider.completionMs.p95)],
 ['40 jobs mock: jobs/min',num(40/(before.provider.elapsedMs/60000)),num(40/(after.provider.elapsedMs/60000)),diff(40/(before.provider.elapsedMs/60000),40/(after.provider.elapsedMs/60000))],
 ['FFmpeg p95, concurrency=1, fixture 4 s',`${num(before.media[0].ffmpegMs.p95)} ms`,`${num(after.media[0].ffmpegMs.p95)} ms`,diff(before.media[0].ffmpegMs.p95,after.media[0].ffmpegMs.p95)],
 ['CPU pico do sistema (baseline comparável)','não medido','não medido','—'],
 ['RAM pico do harness (workloads diferentes)',`${mb(before.resources.peakHarnessRssBytes)} MB`,`${mb(after.resources.peakHarnessRssBytes)} MB`,'não comparável'],
 ['Falhas no cenário de fila sem injeção',0,0,0],
 ['Retry recovery com falha deliberada','sem ensaio comparável na baseline','429/500/checkpoints/crash de lease em testes','—'],
 ['Disco temporário durante upload real','não medido','não medido; disco de derivados em ensaio separado','—']
]
const result=`# Resultados de performance — 2026-10-07

Dados medidos: [baseline](benchmarks/before.json), [posterior](benchmarks/after.json), [200 por conta](benchmarks/account-capacity.json), [storage](benchmarks/storage.json). Primeiros ensaios estão preservados em after-first/account-capacity-first. A última execução de cada cenário substitui somente seu próprio resultado. Ensaios de performance finais foram executados separadamente; o desktop e processos externos não constituem laboratório controlado. Não atribuir toda variação observada a uma alteração específica.

## Hardware e escopo

CPU ${after.hardware.cpu}; ${after.hardware.logicalCpus} threads lógicas, 6 núcleos físicos (CIM); RAM ${mb(after.hardware.ramBytes)} MB. Discos informados pelo Windows: KINGSTON SA400S37240G 240 GB e WDC WD10EURX 1 TB. Diretório temporário no volume C:. Link Ethernet negociado 1 Gbps; banda efetiva de internet não medida. SQLite WAL em arquivo, uma conexão no harness; app usa main + utility process, sem pool/Redis.

Fixture FFmpeg real: 360×640, 4 s, áudio sintético, capa PNG; entrada ${after.media[0].inputBytes} bytes, derivado ${after.media[0].outputBytes.p50} bytes. O ensaio tem oito edições por nível de concorrência; p99 é o máximo da amostra, não uma cauda estatística robusta. Não extrapolar para vídeos longos/1080p/VFR.

## Antes × Depois

${table(['Métrica','Atual / referência','Novo','Diferença observada'],metrics)}

As duas linhas de recibo/preprocessing reproduzem o caminho antigo mantido para edição manual no binário posterior. Elas demonstram que JIT adia o trabalho; não demonstram que FFmpeg codifica mais rápido. A tabela de polling usa a baseline anterior capturada antes das alterações e o worker posterior (2 slots) com o mesmo atraso mock. Falhas e melhoria de recovery não receberam percentuais inventados.

## SQLite: 1/10/25/40/50/100/200 jobs e 1/3/5/10 destinos mock

${table(['Jobs','Contas mock','Enqueue antes ms','Enqueue depois ms','Claim p95 antes ms','Claim p95 depois ms','Lag p95 antes ms','Lag p95 depois ms'],sameQueue)}

Todos esses casos completaram sem falha. JSON inclui p50/p90/p95/p99/max de claim/lag/duração e jobs/min. Contas do ensaio simples são IDs de roteamento, não integrações reais. Claim/complete exercitam SQLite real, mas não passam por mídia/API. Scheduler usa state/priority/run_at e filtros de capacidade, com claim transacional IMMEDIATE. Ainda há custo de JSON e subconsultas de limites; N+1 de leitura da página de fila permanece na auditoria.

## FFmpeg: concurrency 1/2/4/8

${table(['Conc.','p50 ms','p90 ms','p95 ms','p99 ms','max ms','ratio p50','8 jobs total ms','RSS filhos pico amostrado','CPU filhos pico observado','Read/write observados','Amostras'],ffRows)}

CPU é derivada dos contadores de processos observados, normalizada por 12 threads; processos curtos podem escapar entre amostras e a primeira amostra não fornece delta. RAM é a soma observada dos filhos FFmpeg no instante da coleta. Read/write são soma dos máximos observados por PID: limite inferior de I/O de processo, incluindo cache do SO, **não I/O físico de disco**. Dados brutos timestamp/PID estão no JSON. Baseline original não tinha coletor de filhos; não há comparação causal de CPU/RAM dos filhos.

Instrumentação do harness: CPU user/system ${after.resources.cpuMicroseconds.user}/${after.resources.cpuMicroseconds.system} µs, RSS pico ${mb(after.resources.peakHarnessRssBytes)} MB, event-loop p95 ${num(after.resources.eventLoopP95Ms)} ms. Workload posterior inclui replay de 40 edições e sampler PowerShell, logo CPU/RSS agregado não é comparável ao harness inicial. Não há medição de saturação de threads do app.

## 200 jobs por conta no pipeline de publicação

Registro de contas, credenciais, claim, checkpoints, histórico e confirmação são reais. Preparação/transferência são mocks e cada request tem atraso artificial de 1 ms. **Nenhuma chamada às plataformas.**

${table(['Contas registradas','Jobs/conta','Total','Enqueue ms','Drenagem ms','Jobs/h mock','Running pico','Requests mock','Credencial cruzada','Falhas'],capacity.results.map(r=>[r.accountCount,r.jobsPerAccount,r.total,num(r.enqueueMs),num(r.elapsedMs),num(r.jobsPerHour),r.peakActive,r.httpCalls,r.credentialMismatches,r.failed]))}

Cada JSON contém percentis por job e de conclusão do lote. Os casos de 1 conta usam um slot; casos de múltiplas contas atingem dois. Dez destinos são testados como elegíveis, mas não dez uploads/FFmpeg simultâneos. Crescimento/degradação de filas é observável; o máximo de throughput desta amostra é ${num(Math.max(...capacity.results.map(r=>r.jobsPerHour)))} jobs/h **no mock**, não capacidade confortável de produção.

## Armazenamento

Metadados SQLite após fechar/checkpointar WAL:

${table(['Intenções','Baseline bytes','Posterior bytes'],after.storage.map(s=>[s.jobs,before.storage.find(b=>b.jobs===s.jobs).dbBytes,s.dbBytes]))}

${storage?`Ensaio de arquivos reais: o mesmo original/capa/opções repetido, sem hard links; cópias de derivados geradas em pasta temporária. Total de ${storage.elapsedMs.toFixed(0)} ms de cópias/leituras de metadados. Tamanho lógico medido, não blocos físicos alocados.

${table(['Publicações repetidas','Arquivos antigos','Bytes antigos','Arquivos no cache idêntico','Bytes cache JIT','Cópia incremental ms'],storage.samples.map(s=>[s.publications,s.eagerFiles,s.eagerBytes,s.jitCacheFiles,s.jitCacheBytes,num(s.incrementalCopyMs)]))}

Não usar esses números para 5000 vídeos/configurações diferentes: nesse caso cache cresce por derivação única. Originais são preservados e não multiplicados por repostagem. Não foram feitos 5000 uploads nem publicações reais.`:'Ensaio de arquivos ainda indisponível.'}

## Capacidade operacional

- Recepção de 200 intenções: testada; 200 por conta: testada com 1/3/5/10 contas e até 2000 jobs no pipeline com provider mock.
- Fila de metadados testada: 5000 jobs. Disco de derivados repetidos: 5000 arquivos no replay.
- Padrão para piloto: 1 utility process, 2 slots, 1 media slot, 2 exposições/upload slots, 2 publish slots, 1 por conta. Isso é proteção de recursos, não certificação de SLA.
- Carga confortável real em jobs/h: **não determinada**. Máxima real end-to-end: **não determinada**. Internet, transferência por tunnel, processamento/confirmacão Meta e quotas não foram medidos.
- Ponto de saturação de produção: **não determinado**. A concorrência 8 de mídia aumenta latência individual; não foi medido o ponto de colapso. Dados não justificam 8 FFmpeg de produção.
- Limite externo: independente; content_publishing_limit, rate headers, permissões e políticas precisam validação oficial/conta real. Não adotar taxa mock como limite das APIs.

## Reprodução

Executar benchmarks separadamente. PowerShell:

\`\`\`powershell
$env:LEGACY_BENCHMARK='after'; $env:MEDIA_CONCURRENCY='8'
npm test -- src/main/audit/pipeline-benchmark.test.ts
$env:LEGACY_BENCHMARK=$null; $env:MEDIA_CONCURRENCY=$null
$env:LEGACY_CAPACITY_BENCH='1'
npm test -- src/main/audit/account-capacity.test.ts
$env:LEGACY_CAPACITY_BENCH=$null
$env:LEGACY_STORAGE_BENCH='1'
npm test -- src/main/audit/storage-benchmark.test.ts
$env:LEGACY_STORAGE_BENCH=$null
node scripts/report-pipeline-benchmarks.mjs
\`\`\`

Não sobrescrever before.json com o binário posterior e chamar isso de baseline. A baseline é evidência histórica. Armazenamento exige reserva de 4 GiB além das cópias. Suíte normal pula os três benchmarks e executa os testes de resiliência.
`
writeFileSync('docs/performance-results.md',result)
