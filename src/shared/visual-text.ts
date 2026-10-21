/** Font measurement is supplied by the same Canvas context in preview and JIT. */
export function wrapText(text:string,width:number,measure:(text:string)=>number){
  const result:string[]=[]
  for(const paragraph of text.split('\n')){
    let line=''
    for(const word of paragraph.split(/\s+/).filter(Boolean)){
      if(measure(word)>width){
        if(line){result.push(line);line=''}
        for(const {segment} of new Intl.Segmenter('pt-BR',{granularity:'grapheme'}).segment(word)){
          if(line && measure(line+segment)>width){result.push(line);line=''}line+=segment
        }
      }else{
        const candidate=line?`${line} ${word}`:word
        if(line && measure(candidate)>width){result.push(line);line=word}else line=candidate
      }
    }
    result.push(line)
  }return result
}
