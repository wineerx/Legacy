import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Camera as Instagram, Video, Link2, AtSign, MoreHorizontal } from 'lucide-react'
import { AccountConnectionCard } from './AccountConnectionCard'
import { call } from '../../lib/api'
import { useWorkspace } from '../../lib/workspace'
import { Button, Input, Modal, Badge, Spinner, Dropdown, DropdownClose } from '../../components/ui'
import type { PageProps } from '../../routes'

export function AccountsPage({navigate}: PageProps) {
 const {workspace}=useWorkspace();const qc=useQueryClient()
 const [open,setOpen]=useState(false);const [platform,setPlatform]=useState<'instagram'|'tiktok'|null>(null);const [token,setToken]=useState('');const [error,setError]=useState('');const [disconnectOpen,setDisconnectOpen]=useState(false)
 const account=useQuery({queryKey:['instagram-account',workspace.id],queryFn:()=>call('accounts.instagram',{workspaceId:workspace.id})})
 const done=()=>{void qc.invalidateQueries();setError('');setToken('')}
 const fail=(e:unknown)=>setError(e instanceof Error ? e.message : 'Não foi possível confirmar a conexão. Tente novamente.')
 const connect=useMutation({mutationFn:()=>call('accounts.connectInstagram',{workspaceId:workspace.id,token}),onSuccess:done,onError:fail})
 const verify=useMutation({mutationFn:()=>call('accounts.verifyInstagram',{workspaceId:workspace.id}),onSuccess:done,onError:fail})
 const disconnect=useMutation({mutationFn:()=>call('accounts.disconnectInstagram',{workspaceId:workspace.id}),onSuccess:()=>{done();setDisconnectOpen(false)},onError:fail})
 const changeOpen=(v:boolean)=>{if(connect.isPending)return;setOpen(v);if(!v){setPlatform(null);setToken('');setError('')}}
 const showInstagram=()=>{setError('');setPlatform('instagram');setOpen(true)}
 const showTikTok=()=>{setError('');setPlatform('tiktok');setOpen(true)}
 return <div className="mx-auto grid max-w-4xl gap-7 p-6">
 <header className="flex flex-wrap items-center justify-between gap-3">
   <div><h1 className="text-xl font-semibold">Contas</h1><p className="mt-1 text-sm text-dim">Conecte suas redes e gerencie os destinos de publicação.</p></div>
   <Button icon={<Link2 size={16}/>} onClick={()=>{setError('');setPlatform(null);setOpen(true)}}>Conectar conta</Button>
 </header>
 <section aria-labelledby="connected-accounts-heading" className="grid gap-3">
   <h2 id="connected-accounts-heading" className="text-sm font-semibold">Contas conectadas</h2>
   {account.isLoading ? <div role="status" className="flex items-center gap-2 rounded-card border border-line/60 p-4 text-sm text-dim"><Spinner/> Carregando contas…</div> : account.isError ? <div role="alert" className="rounded-card border border-line/60 p-4 text-sm text-danger-fg">Não foi possível consultar a conta. <button onClick={()=>void account.refetch()} className="underline">Tentar novamente</button></div> : account.data ? <div className="flex flex-wrap items-center gap-3 rounded-card border border-line/60 p-4">
     <span className="flex h-10 w-10 items-center justify-center rounded-full border border-line/60" aria-hidden="true"><Instagram size={22}/></span>
     <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold">Instagram</h3><Badge tone="success">Conectado</Badge></div><p className="mt-1 break-all text-sm text-dim">@{account.data.username}</p><p className="mt-1 text-xs text-dim">Verificada em {new Date(account.data.validatedAt).toLocaleString('pt-BR',{timeZone:workspace.timeZone})}</p></div>
     <Button size="sm" onClick={showInstagram}>Gerenciar</Button>
     <Dropdown trigger={<button type="button" aria-label="Opções da conta Instagram" className="flex h-8 w-8 items-center justify-center rounded-ctl text-dim hover:bg-raised hover:text-fg"><MoreHorizontal size={18}/></button>}>
       <DropdownClose asChild><button type="button" onClick={showInstagram}>Gerenciar conexão</button></DropdownClose>
       <DropdownClose asChild><button type="button" className="text-danger-fg" onClick={()=>{setError('');setDisconnectOpen(true)}}>Desconectar conta</button></DropdownClose>
     </Dropdown>
   </div> : <div className="rounded-card border border-dashed border-line/60 p-5"><p className="text-sm">Nenhuma conta conectada</p><p className="mt-1 text-sm text-dim">Escolha uma rede abaixo para começar.</p></div>}
 </section>
 <section aria-labelledby="available-networks-heading" className="grid gap-3">
   <div><h2 id="available-networks-heading" className="text-sm font-semibold">Redes sociais</h2><p className="mt-1 text-sm text-dim">Veja as opções disponíveis para cada plataforma.</p></div>
   <div className="grid grid-cols-1 items-stretch gap-4 sm:grid-cols-2 xl:grid-cols-3">
     <AccountConnectionCard name="Instagram" icon={<Instagram size={23}/>} status={account.isLoading ? 'Carregando' : account.isError ? 'Indisponível' : account.data ? 'Conectado' : 'Não conectado'} connected={!!account.data} description="Conecte sua conta Business ou Creator para publicar Reels pelo Legacy." action={account.data ? 'Gerenciar Instagram' : 'Conectar Instagram'} onAction={!account.isLoading && !account.isError ? showInstagram : undefined}/>
     <AccountConnectionCard name="TikTok" icon={<Video size={23}/>} status="Manual" description="Prepare vídeo, capa e legenda para publicar manualmente no TikTok." action="Preparar exportação" onAction={()=>navigate('compose')} onDetails={showTikTok}/>
     <AccountConnectionCard name="Threads" icon={<AtSign size={23}/>} status="Em breve" description="A conexão com o Threads ainda não está disponível no Legacy." action="Conexão indisponível"/>
   </div>
 </section>
 <Modal open={open} onOpenChange={changeOpen} title={platform==='instagram' ? 'Conectar Instagram' : platform==='tiktok' ? 'TikTok · exportação manual' : 'Conectar uma conta'} description={platform ? 'Revise o método e as permissões antes de continuar.' : 'Escolha uma plataforma.'} footer={<Button onClick={()=>changeOpen(false)}>Fechar</Button>}>
 {!platform ? <div className="grid gap-3"><button className="ds-choice text-left" onClick={()=>setPlatform('instagram')}><Instagram size={22}/><span><strong>Instagram</strong><span className="mt-1 block text-sm text-dim">Conecte sua conta profissional para publicar Reels e acompanhar publicações.</span></span></button><button className="ds-choice text-left" onClick={()=>setPlatform('tiktok')}><Video size={22}/><span><strong>TikTok</strong><span className="mt-1 block text-sm text-dim">Prepare vídeos para postagem manual. API não configurada.</span></span></button></div> : platform==='tiktok' ? <div className="grid gap-4"><p className="text-sm text-dim">Login Kit e Content Posting API precisam de um app TikTok aprovado. Nenhuma conta será vinculada por esta opção.</p><Button variant="primary" onClick={()=>{changeOpen(false);navigate('compose')}}>Preparar exportação</Button></div> : <div className="grid gap-4">{account.data && <div className="ds-summary">Instagram — @{account.data.username} · Conectado</div>}<div className="rounded-ctl border border-line p-3 text-sm"><strong>Permissões solicitadas</strong><ul className="mt-2 grid gap-1 text-xs text-dim"><li>instagram_business_basic · identidade e mídia</li><li>instagram_business_content_publish · publicação de Reels</li></ul><p className="mt-2 text-xs text-dim">A conexão confirma a identidade. A API também verifica a permissão de publicar na execução.</p></div><p className="text-sm text-dim">Gere um Instagram User Access Token no seu app Meta e autorize uma conta Business ou Creator. Em modo de teste, aceite o convite de Testador do Instagram.</p><a href="https://developers.facebook.com/apps/" target="_blank" rel="noreferrer" className="text-sm underline">Abrir painel Meta para gerar token</a><form className="grid gap-3" onSubmit={e=>{e.preventDefault();setError('');connect.mutate()}}><Input label="Token de acesso Instagram" type="password" autoComplete="off" value={token} onChange={e=>setToken(e.target.value)} error={error || undefined}/><Button type="submit" variant="primary" disabled={token.trim().length<20} loading={connect.isPending}>Verificar e conectar conta</Button></form>{account.data && <div className="grid gap-2 border-t border-line pt-3"><p className="text-xs text-dim">Verificada: {new Date(account.data.validatedAt).toLocaleString('pt-BR',{timeZone:workspace.timeZone})}</p><div className="flex flex-wrap gap-2"><Button loading={verify.isPending} onClick={()=>{setError('');verify.mutate()}}>Verificar conexão</Button><Button onClick={()=>setDisconnectOpen(true)}>Desconectar conta</Button></div></div>}<p className="text-xs text-dim">Token protegido pelo Windows. Uma conta por workspace. Trocar o destino não redireciona tarefas antigas. O login no navegador, sozinho, não conecta o Legacy.</p></div>}
 </Modal><Modal open={disconnectOpen} onOpenChange={setDisconnectOpen} title="Desconectar Instagram?" description="O token será removido deste workspace. Agendamentos existentes deixarão de ter autorização; o histórico permanece." footer={<><Button onClick={()=>setDisconnectOpen(false)}>Cancelar</Button><Button variant="danger" loading={disconnect.isPending} onClick={()=>disconnect.mutate()}>Desconectar</Button></>}>{error && <p role="alert" className="text-danger-fg">{error}</p>}</Modal></div>
}
