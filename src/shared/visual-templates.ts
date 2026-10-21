import { z } from 'zod'
import { containerVisualSnapshot, type ContainerVisualSnapshot } from './container-visual'
export const templateInput = z.object({ name:z.string().trim().min(1).max(120), description:z.string().max(2000).default(''), visual:containerVisualSnapshot }).strict()
export interface VisualTemplate { id:string; workspaceId:string; version:number; revision:number; status:'active'|'archived'; name:string; description:string; visual:ContainerVisualSnapshot; createdAt:string; updatedAt:string }
export interface TemplateDetail { template:VisualTemplate; versions:{version:number; name:string; createdAt:string}[] }
export interface TemplatePage { items:VisualTemplate[]; total:number }
