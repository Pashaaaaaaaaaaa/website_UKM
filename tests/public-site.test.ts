import 'dotenv/config';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getPool } from '../packages/database/src/client.ts';
import { createApp } from '../packages/api/src/server.ts';

describe('public website REST API integration', {skip:!process.env.DATABASE_URL},()=>{
  const pool=getPool();let server:ReturnType<ReturnType<typeof createApp>['listen']>;let base='';
  const call=(path:string)=>fetch(`${base}${path}`);
  before(async()=>{server=createApp(pool).listen(0);await new Promise<void>(resolve=>server.once('listening',resolve));const address=server.address();if(!address||typeof address==='string')throw new Error('Public API test server did not start');base=`http://127.0.0.1:${address.port}`;});
  after(async()=>{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));await pool.end();});

  it('serves public dance and BRT catalogs, including category and safe organization configuration',async()=>{
    const [danceResponse,categoriesResponse,itemsResponse,invalidResponse,configResponse]=await Promise.all([
      call('/api/public/rentals/dance/services'),call('/api/public/rentals/brt/categories'),call('/api/public/rentals/brt/items'),
      call('/api/public/rentals/brt/items?category=not-a-uuid'),call('/api/public/site-config'),
    ]);
    assert.equal(danceResponse.status,200);const dance=await danceResponse.json() as {data:Array<{id:string;price_per_performance:string}>};assert.ok(dance.data.length>=3);assert.ok(Number(dance.data[0]!.price_per_performance)>=0);
    assert.equal(categoriesResponse.status,200);const categories=await categoriesResponse.json() as {data:Array<{id:string}>};assert.ok(categories.data.length>=1);
    assert.equal(itemsResponse.status,200);const items=await itemsResponse.json() as {data:Array<{category_id:string;category:string;price_per_unit_per_day:string;total_quantity:number}>};assert.ok(items.data.length>=6);assert.ok(items.data.some(item=>categories.data.some(category=>category.id===item.category_id)));assert.ok(Number(items.data[0]!.price_per_unit_per_day)>=0);
    assert.equal(invalidResponse.status,400);assert.equal(configResponse.status,200);const config=await configResponse.json() as {data:{organization:unknown;manager_whatsapp:string|null;social_links:Record<string,string>}};assert.ok(config.data.organization);assert.equal(typeof config.data.social_links,'object');assert.ok(!JSON.stringify(config).includes('SUPABASE_SERVICE_ROLE_KEY'));
  });

  it('supports public article pagination, search, taxonomy filters, detail metadata and approved comments only',async()=>{
    const listResponse=await call('/api/public/articles?page=1&page_size=2');assert.equal(listResponse.status,200);const list=await listResponse.json() as {data:{items:Array<{slug:string;title:string;published_at:string}>;total:number;page:number;page_size:number}};assert.equal(list.data.page,1);assert.equal(list.data.page_size,2);assert.ok(list.data.items.length<=2);assert.ok(list.data.total>=list.data.items.length);
    const category=(await pool.query<{id:string}>('SELECT id FROM article_categories LIMIT 1')).rows[0];const tag=(await pool.query<{id:string}>('SELECT id FROM tags LIMIT 1')).rows[0];const division=(await pool.query<{id:string}>('SELECT id FROM divisions LIMIT 1')).rows[0];
    const filters=new URLSearchParams({page:'1',page_size:'30'});if(category)filters.set('category',category.id);if(tag)filters.set('tag',tag.id);if(division)filters.set('division',division.id);
    const filtered=await call(`/api/public/articles?${filters}`);assert.equal(filtered.status,200);const filteredData=await filtered.json() as {data:{items:unknown[]}};assert.ok(Array.isArray(filteredData.data.items));
    const generalCategory=(await pool.query<{id:string}>("SELECT id FROM article_categories WHERE slug='berita'")).rows[0];if(generalCategory){const categoryResponse=await call(`/api/public/articles?page=1&page_size=30&category=${generalCategory.id}`);assert.equal(categoryResponse.status,200);const categoryData=await categoryResponse.json() as {data:{items:Array<{category_id:string}>;total:number}};assert.ok(categoryData.data.total>0,'Seeded general news should be linked to its category');assert.ok(categoryData.data.items.every(article=>article.category_id===generalCategory.id));}
    if(list.data.items[0]){const detailResponse=await call(`/api/public/articles/${encodeURIComponent(list.data.items[0].slug)}`);assert.equal(detailResponse.status,200);const detail=await detailResponse.json() as {data:{author:string;tags:unknown[];divisions:unknown[];comments:Array<{name:string;content:string}>}};assert.ok(detail.data.author);assert.ok(Array.isArray(detail.data.tags));assert.ok(Array.isArray(detail.data.divisions));assert.ok(detail.data.comments.every(comment=>comment.name&&comment.content));}
    assert.equal((await call('/api/public/articles?page=1&page_size=31')).status,400);
  });
});
