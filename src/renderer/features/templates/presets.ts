import { blankLayout,newElement,type VisualLayout,type VisualElement } from '@shared/visual-layout'
// Starter documents, not rendering branches. Every field remains editable and is saved in the version.
export function compositionPreset(style:string):VisualLayout{
  const layout=blankLayout(),dark=style==='dark';layout.background=dark?'#080808':'#ffffff'
  if(style==='full'){layout.margin=0;layout.elements=[{...newElement('media','media'),x:0,y:0,width:1080,height:1920,fit:'cover'} as VisualElement];return layout}
  const name={...newElement('text','profile_name'),x:160,y:80,width:800,height:70,text:'{{profile_name}}',fontSize:40,color:dark?'#ffffff':'#000000'} as VisualElement
  const username={...newElement('text','username'),x:160,y:150,width:800,height:70,text:'@{{username}}',fontSize:28,weight:400,color:dark?'#dddddd':'#666666'} as VisualElement
  const title={...newElement('text','title'),x:40,y:280,width:1000,height:260,text:'{{custom_text}}',align:'center',color:dark?'#ffffff':'#000000'} as VisualElement
  const media={...newElement('media','media'),x:48,y:560,width:984,height:1040,radius:style==='center'?0:32} as VisualElement
  const logo={...newElement('image','logo'),x:40,y:80,width:100,height:100,radius:50,visible:false} as VisualElement
  layout.elements=[logo,name,username,title,media]
  if(dark)layout.elements.push({...newElement('text','cta'),x:40,y:1650,width:1000,height:160,text:'Siga a página para mais',align:'center',color:'#ffffff'} as VisualElement)
  return layout
}
