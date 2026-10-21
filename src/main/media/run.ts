import { spawn, type ChildProcess } from 'node:child_process'
import { AppError } from '@shared/errors'
import { pipelineConfig, Semaphore } from '../pipeline-config'
import { recordDiagnostic } from '../diagnostics'
const mediaSlots = new Semaphore(pipelineConfig.mediaConcurrency)
const runningTools=new Set<ChildProcess>()
let shuttingDown=false
export function stopMediaTools() {shuttingDown=true;for(const child of runningTools) child.kill('SIGKILL')}
export class MediaToolError extends AppError {constructor(message:string,public retryable:boolean){super('ffmpeg_failed',message)}}

export function runTool(
  bin: string, args: string[], opts: { timeoutMs?: number; signal?: AbortSignal } = {}
): Promise<{ stdout: string; stderr: string }> {
  return /ffmpeg(?:\.exe)?$/i.test(bin) ? mediaSlots.run(() => executeTool(bin,args,opts)) : executeTool(bin,args,opts)
}

function executeTool(bin: string, args: string[], opts: { timeoutMs?: number; signal?: AbortSignal }) : Promise<{ stdout: string; stderr: string }> {
  if(shuttingDown) return Promise.reject(new AppError('internal','Processamento interrompido durante encerramento.'))
  return new Promise((resolvePromise, reject) => {
    const started = performance.now()
    const child = spawn(bin, args, { shell: false, windowsHide: true, signal: opts.signal })
    runningTools.add(child)
    recordDiagnostic({source:'media',level:'DEBUG',message:'Ferramenta de mídia iniciada',metadata:{pid:child.pid,parentPid:process.pid,tool:/ffprobe/i.test(bin)?'ffprobe':'ffmpeg'}})
    let stdout = ''
    let stderr = ''
    let timedOut = false
    const timeoutMs = opts.timeoutMs ?? pipelineConfig.jobTimeoutMs
    child.stdout.on('data', (d) => { stdout += d })
    child.stderr.on('data', (d) => { stderr = (stderr + d).slice(-20_000) })
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL') }, timeoutMs)
    child.on('error', (e) => { clearTimeout(timer); reject(new MediaToolError(e.message,e.name==='AbortError')) })
    child.on('close', (code) => {
      runningTools.delete(child)
      clearTimeout(timer)
      recordDiagnostic({source:'media',level:code===0?'INFO':'ERROR',message:'Processamento de mídia finalizado',duration:performance.now()-started,metadata:{pid:child.pid,parentPid:process.pid,exitCode:code,timedOut}})
      if(shuttingDown) return reject(new AppError('internal','Processamento interrompido durante encerramento.'))
      if (timedOut) return reject(new MediaToolError(`Processamento excedeu o tempo limite de ${Math.round(timeoutMs / 1000)} s.`,true))
      if (code === 0) return resolvePromise({ stdout, stderr })
      const tail = stderr.trim().split(/\r?\n/).slice(-4).join(' | ')
      reject(new MediaToolError(`Processamento falhou (código ${code}): ${tail}`,code===null))
    })
  })
}
