import type pg from 'pg';
import { Router, type Response } from 'express';
import { z } from 'zod';
import { getSupabaseProjectUrl } from '../../storage/src/supabase.ts';
import { createAdminAuthMiddleware, requireRole } from './auth.ts';

const data=(res:Response,value:unknown,status=200)=>res.status(status).json({data:value});
const slots=['hero-1','hero-2','hero-3','hero-4','about','structure-1','structure-2','structure-3','structure-4','structure-5','service','footer'] as const;
const Slot=z.enum(slots);
const MediaId=z.string().uuid().nullable();
const publicUrl=(id:string|null,bucket:string|null,path:string|null)=>{
  if(!id||!path)return null;
  if(path.startsWith('local:'))return `${process.env.API_BASE_URL??'http://localhost:4000'}/api/public/media/${id}/content`;
  const base=getSupabaseProjectUrl();
  return base&&bucket?`${base}/storage/v1/object/public/${bucket}/${path.split('/').map(encodeURIComponent).join('/')}`:null;
};

export function createPublicHomepageMediaRouter(pool:pg.Pool){
  const router=Router();
  router.get('/home-media',async(_req,res)=>{
    try{
      const rows=(await pool.query(`SELECT s.slot_key,s.media_id,m.bucket,m.object_path,m.alt_text FROM homepage_media_slots s LEFT JOIN media_assets m ON m.id=s.media_id ORDER BY s.slot_key`)).rows;
      return data(res,rows.map(row=>({...row,url:publicUrl(row.media_id,row.bucket,row.object_path)})));
    }catch{return res.status(500).json({error:{code:'INTERNAL_ERROR',message:'Unable to load homepage media.'}});}
  });
  return router;
}

export function createAdminHomepageMediaRouter(pool:pg.Pool){
  const router=Router();
  router.use(createAdminAuthMiddleware(pool),requireRole('NEWS_ADMIN'));
  router.get('/home-media',async(_req,res)=>{
    try{
      const rows=(await pool.query(`SELECT s.slot_key,s.media_id,m.bucket,m.object_path,m.alt_text FROM homepage_media_slots s LEFT JOIN media_assets m ON m.id=s.media_id ORDER BY s.slot_key`)).rows;
      return data(res,rows.map(row=>({...row,url:publicUrl(row.media_id,row.bucket,row.object_path)})));
    }
    catch{return res.status(500).json({error:{code:'INTERNAL_ERROR',message:'Unable to load homepage media settings.'}});}
  });
  router.put('/home-media/:slot',async(req,res)=>{
    const slot=Slot.safeParse(req.params.slot),input=z.object({media_id:MediaId}).strict().safeParse(req.body);
    if(!slot.success||!input.success)return res.status(400).json({error:{code:'VALIDATION_ERROR',message:'Invalid homepage media slot.'}});
    try{
      if(input.data.media_id){
        const media=await pool.query(`SELECT id FROM media_assets WHERE id=$1 AND bucket='organization'`,[input.data.media_id]);
        if(!media.rowCount)return res.status(400).json({error:{code:'INVALID_MEDIA',message:'Gambar tidak ditemukan di penyimpanan organisasi. Unggah ulang gambar tersebut.'}});
      }
      const row=(await pool.query(`INSERT INTO homepage_media_slots(slot_key,media_id,updated_by) VALUES($1,$2,$3) ON CONFLICT(slot_key) DO UPDATE SET media_id=EXCLUDED.media_id,updated_by=EXCLUDED.updated_by,updated_at=now() RETURNING *`,[slot.data,input.data.media_id,req.admin!.id])).rows[0];
      return data(res,row);
    }catch{return res.status(500).json({error:{code:'INTERNAL_ERROR',message:'Unable to save homepage media.'}});}
  });
  return router;
}
