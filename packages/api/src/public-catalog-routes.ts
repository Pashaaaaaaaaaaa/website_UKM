import type pg from 'pg';
import { Router } from 'express';
import { z } from 'zod';

const wrap=(res:import('express').Response,data:unknown,status=200)=>res.status(status).json({data});
const safeSocialLinks=(value:unknown):Record<string,string>=>{let parsed=value;if(typeof value==='string'){try{parsed=JSON.parse(value);}catch{return {};}}if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))return {};return Object.fromEntries(Object.entries(parsed).filter(([key,url])=>/^[a-z0-9_-]{1,32}$/i.test(key)&&typeof url==='string'&&/^https:\/\//i.test(url)).slice(0,12));};
const publicUrl=(bucket:string,path:string)=>{const base=process.env.SUPABASE_URL?.replace(/\/$/,'');return base?`${base}/storage/v1/object/public/${bucket}/${path.split('/').map(encodeURIComponent).join('/')}`:null;};

export function createPublicCatalogRouter(pool:pg.Pool){const router=Router();
 router.get('/rentals/dance/services',async(_req,res)=>{try{const result=await pool.query(`SELECT d.id,d.name,d.slug,d.description,d.price_per_performance,d.image_media_id,
   m.bucket media_bucket,m.object_path media_path,m.alt_text image_alt
   FROM dance_services d LEFT JOIN media_assets m ON m.id=d.image_media_id
   WHERE d.is_active ORDER BY d.name`);return wrap(res,result.rows.map(row=>({...row,image_url:row.media_bucket&&row.media_path?publicUrl(row.media_bucket,row.media_path):null})));}catch{return res.status(500).json({error:{code:'INTERNAL_ERROR',message:'Unable to load dance services.'}});}});
 router.get('/rentals/brt/categories',async(_req,res)=>{try{return wrap(res,(await pool.query('SELECT id,name,slug FROM inventory_categories ORDER BY name')).rows);}catch{return res.status(500).json({error:{code:'INTERNAL_ERROR',message:'Unable to load rental categories.'}});}});
 router.get('/rentals/brt/items',async(req,res)=>{const category=typeof req.query.category==='string'?req.query.category:null;if(category&&!z.string().uuid().safeParse(category).success)return res.status(400).json({error:{code:'VALIDATION_ERROR',message:'Invalid inventory category filter.'}});try{const result=await pool.query(`SELECT i.id,i.name,i.slug,i.description,i.price_per_unit_per_day,i.total_quantity,i.category_id,c.name category,
   m.bucket media_bucket,m.object_path media_path,m.alt_text image_alt
   FROM inventory_items i JOIN inventory_categories c ON c.id=i.category_id LEFT JOIN media_assets m ON m.id=i.image_media_id
   WHERE i.is_active AND ($1::uuid IS NULL OR i.category_id=$1) ORDER BY c.name,i.name`,[category]);return wrap(res,result.rows.map(row=>({...row,image_url:row.media_bucket&&row.media_path?publicUrl(row.media_bucket,row.media_path):null})));}catch{return res.status(500).json({error:{code:'INTERNAL_ERROR',message:'Unable to load BRT inventory.'}});}});
 router.get('/site-config',async(_req,res)=>{try{const organization=(await pool.query('SELECT name,description,address,phone,email FROM organization_info LIMIT 1')).rows[0]??null;const settings=(await pool.query("SELECT key,value FROM system_settings WHERE key IN ('manager_whatsapp','social_links')")).rows as Array<{key:string;value:unknown}>;const configured=new Map(settings.map(row=>[row.key,row.value]));const rawWhatsapp=process.env.PUBLIC_MANAGER_WHATSAPP??configured.get('manager_whatsapp')??organization?.phone??null;const whatsapp=typeof rawWhatsapp==='string'?rawWhatsapp:null;const social=safeSocialLinks(process.env.PUBLIC_SOCIAL_LINKS||configured.get('social_links')||{});return wrap(res,{organization,manager_whatsapp:whatsapp,social_links:social});}catch{return res.status(500).json({error:{code:'INTERNAL_ERROR',message:'Unable to load public site settings.'}});}});
 return router;}
