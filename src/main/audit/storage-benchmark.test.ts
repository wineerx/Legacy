import { it, expect } from 'vitest'
import { mkdtempSync, copyFileSync, statSync, statfsSync, mkdirSync, writeFileSync, rmSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { performance } from 'node:perf_hooks'
import { makeTestVideo } from '../media/test-fixtures'
import { extractFrame, renderVideoVersion } from '../media/ops'

it.skipIf(!process.env.LEGACY_STORAGE_BENCH)('measures actual repeated derivative files at 100/500/1000/5000 publications',async()=>{
  const root=mkdtempSync(join(tmpdir(),'legacy-storage-bench-'))
  try {
    const video=join(root,'original.mp4'),png=join(root,'cover.png'),derived=join(root,'derived.mp4'),old=join(root,'eager'),cache=join(root,'cache')
    await makeTestVideo(video);await extractFrame(video,0,png);await renderVideoVersion(video,derived,{coverPng:png})
    const bytes=statSync(derived).size,fs=statfsSync(root),freeBytes=fs.bavail*fs.bsize
    if(freeBytes<bytes*5000+4*1024**3)throw Error('Insufficient free space for isolated 5000-file test plus 4 GiB reserve')
    mkdirSync(old);mkdirSync(cache);copyFileSync(derived,join(cache,'one-identical-derivative.mp4'))
    const samples=[];let previous=0;const started=performance.now()
    for(const publications of [100,500,1000,5000]) {
      const t=performance.now()
      for(let i=previous;i<publications;i++)copyFileSync(derived,join(old,`${i}.mp4`))
      const eagerFiles=readdirSync(old);expect(eagerFiles).toHaveLength(publications)
      const eagerBytes=eagerFiles.reduce((total,name)=>total+statSync(join(old,name)).size,0)
      samples.push({publications,eagerFiles:eagerFiles.length,eagerBytes,jitCacheFiles:readdirSync(cache).length,jitCacheBytes:statSync(join(cache,'one-identical-derivative.mp4')).size,incrementalCopyMs:performance.now()-t})
      previous=publications
    }
    mkdirSync(resolve('docs/benchmarks'),{recursive:true});writeFileSync(resolve('docs/benchmarks/storage.json'),JSON.stringify({scenario:'Repeated publications of the identical original/banner/options: actual copies on disk, no hard links. Measures logical file sizes, not allocated physical blocks. Unique media/configurations are not represented.',inputBytes:statSync(video).size,derivativeBytes:bytes,freeBeforeBytes:freeBytes,elapsedMs:performance.now()-started,samples},null,2))
  }finally{
    const absolute=resolve(root),expected=resolve(tmpdir())+sep+'legacy-storage-bench-'
    if(!absolute.startsWith(expected))throw Error('Unsafe benchmark cleanup path')
    rmSync(absolute,{recursive:true,force:true})
  }
},300000)
