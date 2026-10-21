import { expect,it } from 'vitest'
import { blankLayout,newElement,resolveLayout,visualLayout,expandText,fitRect } from './visual-layout'
it('accepts editable layouts and rejects ambiguous media/IDs, malformed colors and excessive canvases',()=>{
  const layout=blankLayout();expect(visualLayout.safeParse(layout).success).toBe(true)
  expect(visualLayout.safeParse({...layout,elements:[layout.elements[0],layout.elements[0]]}).success).toBe(false)
  expect(visualLayout.safeParse({...layout,elements:[layout.elements[0],{...layout.elements[0],id:'second'}]}).success).toBe(false)
  expect(visualLayout.safeParse({...layout,background:'red'}).success).toBe(false)
  expect(visualLayout.safeParse({...layout,width:1081}).success).toBe(false)
})
it('dynamic substitutions are literal, bounded, per-item, and cannot inject new variables',()=>{
  expect(expandText('{{custom_text}}',{custom_text:'{{caption}}'},true)).toBe('{{caption}}')
  expect(()=>expandText('{{username}}',{},true)).toThrow(/username/)
  expect(()=>expandText('{{unsupported}}',{})).toThrow(/desconhecida/)
  expect(()=>expandText('{{caption}}{{caption}}',{caption:'a'.repeat(3000)})).toThrow(/4.000/)
  const scene={...blankLayout(),elements:[{...newElement('text','title'),type:'text' as const,text:'{{caption}}',font:'Inter' as const,weight:700 as const,fontSize:48,lineHeight:1.2,color:'#ffffff',align:'center' as const,padding:8}]}
  expect(resolveLayout(scene,{caption:'A'}).elements[0]).toMatchObject({text:'A'})
  expect(scene.elements[0].text).toBe('{{caption}}')
})
it('preview and JIT use the same contain/cover alignment geometry',()=>{
  const element={...newElement('media','m'),type:'media' as const,x:20,y:30,width:100,height:100,fit:'contain' as const,alignX:50,alignY:50}
  expect(fitRect(200,100,element)).toEqual({x:20,y:55,width:100,height:50})
  expect(fitRect(200,100,{...element,fit:'cover',alignX:100})).toEqual({x:-80,y:30,width:200,height:100})
})
