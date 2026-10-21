import * as Primitive from '@radix-ui/react-slider'
export function Slider({value,onChange,disabled,label,min=0,max=100}:{value:number;onChange(v:number):void;disabled?:boolean;label:string;min?:number;max?:number}){
  return <Primitive.Root aria-label={label} disabled={disabled} min={min} max={max} value={[value]} onValueChange={v=>onChange(v[0])} className="relative flex h-5 w-full touch-none items-center"><Primitive.Track className="relative h-1 grow rounded-full bg-raised"><Primitive.Range className="absolute h-full rounded-full bg-fg" /></Primitive.Track><Primitive.Thumb className="size-4 rounded-full border border-line bg-fg focus-visible:outline-2 focus-visible:outline-fg" /></Primitive.Root>
}
