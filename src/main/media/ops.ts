import { AppError } from '@shared/errors'
import { ffmpegPaths } from './ffmpeg-bin'
import { runTool } from './run'
import { h264Candidates } from './encoders'
import { probe } from './probe'
import { watermarkGeometry, type ContainerVisualSnapshot } from '@shared/container-visual'
import { fitRect, type VisualLayout } from '@shared/visual-layout'
import { mediaElement } from '@shared/visual-raster'

const ff = (args: string[], timeoutMs?: number) => runTool(ffmpegPaths().ffmpeg, ['-y', '-hide_banner', '-v', 'error', ...args], { timeoutMs })
const seconds = (ms: number) => (ms / 1000).toFixed(3)

export async function extractFrame(input: string, atMs: number, outPng: string, width?: number): Promise<void> {
  const vf = width ? ['-vf', `scale=${width}:-2`] : []
  await ff(['-ss', seconds(atMs), '-i', input, '-frames:v', '1', ...vf, outPng], 60_000)
}

export async function makeThumbnail(input: string, outJpg: string, durationMs: number): Promise<void> {
  const at = Math.max(500, Math.floor(durationMs * 0.1))
  await ff(['-ss', seconds(at), '-i', input, '-frames:v', '1', '-vf', 'scale=360:-2', '-q:v', '4', outJpg], 60_000)
}

export async function stripMetadata(input: string, out: string): Promise<void> {
  await ff(['-i', input, '-map', '0', '-map_metadata', '-1', '-map_chapters', '-1', '-c', 'copy', '-movflags', '+faststart', out])
}

let cachedEncoder: string | null = null

export async function detectH264Encoder(): Promise<string> {
  if (cachedEncoder) return cachedEncoder
  const { stdout } = await runTool(ffmpegPaths().ffmpeg, ['-hide_banner', '-encoders'], { timeoutMs: 30_000 })
  for (const enc of h264Candidates(stdout)) {
    try {
      await runTool(ffmpegPaths().ffmpeg, [
        '-hide_banner', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=128x128:d=0.2',
        '-frames:v', '3', ...encoderArgs(enc), '-f', 'null', '-'
      ], { timeoutMs: 15_000 })
      cachedEncoder = enc
      return enc
    } catch {
      // encoder listado mas não inicializa neste computador; tenta o próximo
    }
  }
  throw new AppError('ffmpeg_failed', 'Nenhum encoder H.264 disponível neste computador. Atualize o driver de vídeo ou o Windows.')
}

function encoderArgs(encoder: string, bitrate = '8M'): string[] {
  if (encoder === 'libopenh264') return ['-c:v', encoder, '-b:v', bitrate]
  if (encoder === 'h264_mf') return ['-c:v', encoder, '-b:v', bitrate, '-rate_control', 'cbr']
  return ['-c:v', encoder, '-b:v', bitrate]
}

export type BannerWindow = { startMs: number; endMs: number }

function assertWindow(window: BannerWindow): void {
  if (!Number.isFinite(window.startMs) || !Number.isFinite(window.endMs) || window.startMs < 0) throw new AppError('invalid_input', 'O intervalo do banner é inválido.')
  if (window.endMs <= window.startMs) throw new AppError('invalid_input', 'O fim do banner precisa ser depois do início.')
}

/** Duração do frame de capa inserido antes do vídeo: um quadro a 30 fps, imperceptível na reprodução. */
export const COVER_FRAME_MS = 33

/**
 * Gera a versão editada em uma única codificação: banner sobreposto no intervalo pedido e,
 * opcionalmente, a capa como primeiro frame. O primeiro frame contém a capa/banner e pode ser escolhido como miniatura
 * pela plataforma; a API Instagram recebe thumb_offset=0 para essa referência.
 */
export async function renderVideoVersion(input: string, out: string, opts: { banner?: { png: string; window: BannerWindow; firstFrame?: boolean }; coverPng?: string; watermark?: { png: string; width: number; height: number; spec: NonNullable<ContainerVisualSnapshot['watermark']> } }): Promise<void> {
  if (!opts.banner && !opts.coverPng && !opts.watermark) throw new AppError('invalid_input', 'Nada a aplicar no vídeo.')
  if (opts.banner) assertWindow(opts.banner.window)
  const p = await probe(input)
  const encoder = await detectH264Encoder()
  const w = p.displayWidth, h = p.displayHeight
  const args = ['-i', input]
  const chains: string[] = []
  let main = '[0:v]'
  let next = 1
  if (opts.banner) {
    args.push('-i', opts.banner.png)
    const b = `[${next++}:v]`
    const { startMs, endMs } = opts.banner.window
    chains.push(`${b}scale=${w}:${h}[bn]`, `${main}[bn]overlay=0:0:enable='${opts.banner.firstFrame === false ? '' : 'eq(n,0)+'}between(t,${seconds(startMs)},${seconds(endMs)})'[ov]`)
    main = '[ov]'
  }
  chains.push(`${main}scale=${w}:${h},setsar=1,format=yuv420p[main]`)
  let video = '[main]'
  if (opts.coverPng) {
    args.push('-loop', '1', '-framerate', '30', '-t', '0.2', '-i', opts.coverPng)
    const c = `[${next++}:v]`
    chains.push(`${c}scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},setsar=1,format=yuv420p,trim=end_frame=1,setpts=PTS-STARTPTS[cover]`, `[cover][main]concat=n=2:v=1:a=0[v]`)
    video = '[v]'
  }
  if (opts.watermark) {
    const watermark = opts.watermark
    const geometry = watermarkGeometry(w, h, watermark, watermark.spec)
    args.push('-i', watermark.png)
    chains.push(`[${next++}:v]scale=${geometry.width}:${geometry.height},format=rgba,colorchannelmixer=aa=${watermark.spec.opacityPct / 100}[wm]`, `${video}[wm]overlay=${geometry.x}:${geometry.y}:format=auto,format=yuv420p[watermarked]`)
    video = '[watermarked]'
  }
  const audio = p.audioCodec
    ? opts.coverPng
      ? ['-filter_complex', `${chains.join(';')};[0:a]adelay=delays=${COVER_FRAME_MS}:all=1[a]`, '-map', video, '-map', '[a]', '-c:a', 'aac', '-b:a', '192k']
      : ['-filter_complex', chains.join(';'), '-map', video, '-map', '0:a', '-c:a', 'copy']
    : ['-filter_complex', chains.join(';'), '-map', video]
  // concat uses a microsecond time base. Media Foundation accepts the simple
  // detection fixture but cannot initialize against that VFR composition.
  const timing = encoder === 'h264_mf' ? ['-fps_mode', 'cfr', '-r', '30', '-enc_time_base', '1:30'] : ['-fps_mode', 'vfr']
  await ff([...args, ...audio, ...encoderArgs(encoder, String(Math.max(8_000_000, Math.ceil(p.sizeBytes * 8 / Math.max(0.001, p.durationMs / 1000))))), ...timing, '-map_metadata', '0', '-movflags', '+faststart', out])
}

export async function overlayBanner(input: string, bannerPng: string, out: string, window: BannerWindow): Promise<void> {
  assertWindow(window)
  await renderVideoVersion(input, out, { banner: { png: bannerPng, window } })
}

/** Raster layers use exactly the preview's Canvas painter; FFmpeg only places the moving media. */
export async function renderComposition(input:string,out:string,layout:VisualLayout,raster:{background:string;layers:{id:string;path:string}[];mask?:string;mediaBorder?:string}){
  const p=await probe(input),encoder=await detectH264Encoder(),args=['-i',input,'-loop','1','-i',raster.background]
  const chains=[`[1:v]format=rgba,setsar=1[background]`];let current='[background]',next=2,seq=0
  for(const element of layout.elements){
    if(!element.visible)continue
    const label=`[layer${seq++}]`
    if(element.type==='media' && !element.imageData){
      const geometry=fitRect(p.displayWidth,p.displayHeight,element),w=Math.max(1,Math.round(element.width)),h=Math.max(1,Math.round(element.height))
      const rw=Math.max(1,Math.round(geometry.width)),rh=Math.max(1,Math.round(geometry.height)),ox=Math.round(geometry.x-element.x),oy=Math.round(geometry.y-element.y)
      // Independent rounding can push the offset 1 px past the box; clamp so crop/pad always fit.
      const clamp=(v:number,max:number)=>Math.min(Math.max(0,v),Math.max(0,max))
      const adjust=element.fit==='cover'?`crop=${Math.min(w,rw)}:${Math.min(h,rh)}:${clamp(-ox,rw-w)}:${clamp(-oy,rh-h)},pad=${w}:${h}:0:0:color=black@0`:`pad=${w}:${h}:${clamp(ox,w-rw)}:${clamp(oy,h-rh)}:color=black@0`
      chains.push(`[0:v]scale=${rw}:${rh},format=rgba,${adjust},setsar=1[moving]`)
      if(raster.mask){args.push('-i',raster.mask);chains.push(`[${next++}:v]format=gray[mask]`,`[moving]split[rgba][alpha]`,`[alpha]alphaextract[originalAlpha]`,`[originalAlpha][mask]blend=all_mode=multiply[combinedAlpha]`,`[rgba][combinedAlpha]alphamerge,colorchannelmixer=aa=${element.opacity/100}[masked]`)}
      chains.push(`${current}${raster.mask?'[masked]':'[moving]'}overlay=${Math.round(element.x)}:${Math.round(element.y)}:format=auto${label}`);current=label
      if(raster.mediaBorder){args.push('-i',raster.mediaBorder);const border=`[border${seq++}]`;chains.push(`${current}[${next++}:v]overlay=0:0:format=auto${border}`);current=border}
    }else{
      const layer=raster.layers.find(v=>v.id===element.id);if(!layer)continue;args.push('-i',layer.path)
      const enable=element.type==='banner'?`:enable='between(t,${seconds(element.startMs)},${seconds(element.endMs)})'`:''
      chains.push(`${current}[${next++}:v]overlay=0:0:format=auto${enable}${label}`);current=label
    }
  }
  chains.push(`${current}format=yuv420p[composed]`)
  await ff([...args,'-filter_complex',chains.join(';'),'-map','[composed]','-map','0:a?','-c:a','copy',...encoderArgs(encoder),'-t',seconds(p.durationMs),'-r','30','-map_metadata','0','-movflags','+faststart',out])
}

export type AudioTrackOptions = { mode: 'replace' | 'mix'; volumePct: number; originalVolumePct: number; startMs: number }

/**
 * Applies a separate audio track without re-encoding the picture. `replace` drops the original
 * sound; `mix` keeps it under the track. A short track is padded with silence, a long one is cut.
 */
export async function applyAudioTrack(video: string, track: string, out: string, opts: AudioTrackOptions): Promise<void> {
  const p = await probe(video)
  const gain = (pct: number) => (pct / 100).toFixed(2)
  const music = `[1:a]volume=${gain(opts.volumePct)},apad`
  const graph = opts.mode === 'mix' && p.audioCodec
    ? `${music}[music];[0:a]volume=${gain(opts.originalVolumePct)}[original];[original][music]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[a]`
    : `${music}[a]`
  await ff(['-protocol_whitelist', 'file', '-i', video, '-ss', seconds(opts.startMs), '-protocol_whitelist', 'file', '-i', track,
    '-filter_complex', graph, '-map', '0:v:0', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-t', seconds(p.durationMs),
    '-map_metadata', '0', '-movflags', '+faststart', out])
  if (!(await probe(out, true)).audioCodec) throw new AppError('invalid_media', 'A faixa de áudio não foi aplicada.')
}

export async function mergeAudio(video: string, audio: string, out: string): Promise<void> {
  const duration = (await probe(video, true)).durationMs
  await ff(['-protocol_whitelist', 'file', '-i', video, '-protocol_whitelist', 'file', '-i', audio,
    '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-t', seconds(duration), '-movflags', '+faststart', out])
  if (!(await probe(out, true)).audioCodec) throw new AppError('invalid_media', 'A faixa de áudio não foi preservada.')
}
