import 'dotenv/config';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { getPool } from '../packages/database/src/client.ts';
import { createApp } from '../packages/api/src/server.ts';
import { createBooking } from '../packages/api/src/booking-service.ts';

const enabled=Boolean(process.env.DATABASE_URL);
describe('CMS and administrative management API', {skip:!enabled},()=>{
 const pool=getPool();let server:ReturnType<ReturnType<typeof createApp>['listen']>;let base='';let news='';let manager='';let brt='';
 const call=(path:string,method='GET',cookie=news,body?:unknown)=>fetch(`${base}${path}`,{method,headers:{...(cookie?{cookie}:{}),...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
 async function login(email:string){const r=await fetch(`${base}/api/admin/auth/login`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,password:'ChangeMe-Dev-Only-123!'})});assert.equal(r.status,200);return r.headers.get('set-cookie')!.split(';')[0]!;}
 before(async()=>{server=createApp(pool).listen(0);await new Promise<void>(resolve=>server.once('listening',resolve));const address=server.address();if(!address||typeof address==='string')throw new Error('API test server did not start');base=`http://127.0.0.1:${address.port}`;news=await login('news-admin@development.invalid');manager=await login('manager@development.invalid');brt=await login('brt-admin@development.invalid');});
 after(async()=>{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));await pool.end();});

 it('creates, edits, publishes, unpublishes and deletes news with taxonomy relationships and unique slugs',async()=>{
  const suffix=randomUUID();const make=async(endpoint:string,name:string)=>{const r=await call(`/api/admin/news/${endpoint}`,'POST',news,{name,slug:`${name.toLowerCase()}-${suffix}`});assert.equal(r.status,201);return (await r.json() as {data:{id:string}}).data.id;};
  const category=await make('categories','Category');const tag=await make('tags','Tag');const division=await make('divisions','Division');
  const payload={title:'CMS article',slug:`cms-${suffix}`,excerpt:'Summary',content:'First draft',category_id:category,tag_ids:[tag],division_ids:[division],status:'DRAFT'};
  let response=await call('/api/admin/news/articles','POST',news,payload);assert.equal(response.status,201);const article=(await response.json() as {data:{id:string;status:string}}).data;assert.equal(article.status,'DRAFT');
  response=await call('/api/admin/news/articles','POST',news,payload);assert.equal(response.status,409);
  response=await call(`/api/admin/news/articles/${article.id}`,'PUT',news,{...payload,title:'Edited article'});assert.equal(response.status,200);
  response=await call(`/api/admin/news/articles/${article.id}/status`,'PATCH',news,{status:'PUBLISHED'});assert.equal(response.status,200);
  const publicResponse=await call(`/api/public/articles/${payload.slug}`);assert.equal(publicResponse.status,200);
  const filtered=await call(`/api/admin/news/articles?tag=${tag}&division=${division}`, 'GET',news);assert.equal(filtered.status,200);assert.ok(((await filtered.json() as {data:unknown[]}).data).length>=1);
  response=await call(`/api/admin/news/articles/${article.id}/status`,'PATCH',news,{status:'UNPUBLISHED'});assert.equal(response.status,200);assert.equal((await call(`/api/public/articles/${payload.slug}`)).status,404);
  await call(`/api/admin/news/articles/${article.id}`,'DELETE',news);await call(`/api/admin/news/categories/${category}`,'DELETE',news);await call(`/api/admin/news/tags/${tag}`,'DELETE',news);await call(`/api/admin/news/divisions/${division}`,'DELETE',news);
 });

 it('moderates visitor comments and only exposes approved comments publicly',async()=>{
  const suffix=randomUUID(),slug=`comment-${suffix}`;const created=await call('/api/admin/news/articles','POST',news,{title:'Comment target',slug,content:'article',status:'PUBLISHED'});assert.equal(created.status,201);const id=(await created.json() as {data:{id:string}}).data.id;
  const posted=await call(`/api/public/articles/${slug}/comments`,'POST','',{name:'Visitor',email:'visitor@example.test',content:'<script>alert(1)</script>Useful thought'});assert.equal(posted.status,201,JSON.stringify(await posted.clone().json()));const comment=(await posted.json() as {data:{id:string;status:string}}).data;assert.equal(comment.status,'PENDING');
  assert.equal((await call(`/api/public/articles/${slug}/comments`,'POST','',{name:'Visitor',content:'Another useful thought'})).status,201);
  assert.equal((await call(`/api/public/articles/${slug}/comments`,'POST','',{name:'Visitor',content:'One more useful thought'})).status,201);
  assert.equal((await call(`/api/public/articles/${slug}/comments`,'POST','',{name:'Visitor',content:'Rate limited comment'})).status,429);
  let article=await (await call(`/api/public/articles/${slug}`)).json() as {data:{comments:unknown[]}};assert.equal(article.data.comments.length,0);
  assert.equal((await call(`/api/admin/news/comments/${comment.id}/moderation`,'PATCH',news,{status:'APPROVED'})).status,200);
  const approvedArticle=await (await call(`/api/public/articles/${slug}`)).json() as {data:{comments:Array<{content:string}>}};assert.equal(approvedArticle.data.comments.length,1);assert.ok(!approvedArticle.data.comments[0]!.content.includes('<script>'));
  await call(`/api/admin/news/articles/${id}`,'DELETE',news);
 });

 it('updates organization information and keeps members in requested order',async()=>{
  const org=await call('/api/admin/news/organization','PUT',news,{name:'Test organization',description:'Description',history:'History'});assert.equal(org.status,200);
  const one=await call('/api/admin/news/organization/members','POST',news,{name:'Member A',position:'Role',sort_order:-10});const two=await call('/api/admin/news/organization/members','POST',news,{name:'Member B',position:'Role',sort_order:-20});assert.equal(one.status,201);assert.equal(two.status,201);
  const response=await call('/api/public/organization');const result=await response.json() as {data:{organization:{name:string};members:Array<{name:string}>}};assert.equal(result.data.organization.name,'Test organization');assert.equal(result.data.members[0]!.name,'Member B');
 });

 it('isolates Dance and BRT CRUD by role and validates created inventory data',async()=>{
  const suffix=randomUUID();const dance=await call('/api/admin/rentals/dance/manage/services','POST',manager,{name:'Test dance',slug:`dance-${suffix}`,description:'Description',price_per_performance:100});assert.equal(dance.status,201);
  assert.equal((await call('/api/admin/rentals/brt/manage/items','GET',manager)).status,403);
  const category=await call('/api/admin/rentals/brt/manage/categories','POST',brt,{name:'Test category',slug:`category-${suffix}`});assert.equal(category.status,201);const categoryId=(await category.json() as {data:{id:string}}).data.id;
  const item=await call('/api/admin/rentals/brt/manage/items','POST',brt,{category_id:categoryId,name:'Test item',slug:`item-${suffix}`,description:'BRT item',price_per_unit_per_day:12.5,total_quantity:7});assert.equal(item.status,201);
  const itemId=(await item.json() as {data:{id:string}}).data.id;const start=new Date(Date.now()+110*86400000).toISOString().slice(0,10);const held=await createBooking(pool,{customer_name:'Capacity test',customer_phone:'0800000000',domain:'BRT',items:[{item_id:itemId,quantity:3}],start_date:start,end_date:start});
  assert.equal((await call(`/api/admin/rentals/brt/manage/items/${itemId}`,'PUT',brt,{category_id:categoryId,name:'Test item',slug:`item-${suffix}`,description:'BRT item',price_per_unit_per_day:12.5,total_quantity:2})).status,409);
  await pool.query('DELETE FROM bookings WHERE booking_code=$1',[held.booking_code]);
  assert.equal((await call('/api/admin/rentals/dance/manage/services','GET',brt)).status,403);
  assert.equal((await call('/api/admin/rentals/brt/manage/items','GET','')).status,401);
  await call(`/api/admin/rentals/brt/manage/items/${itemId}`,'DELETE',brt);await call(`/api/admin/rentals/brt/manage/categories/${categoryId}`,'DELETE',brt);
 });

 it('blocks cross-role payment confirmation and enforces media bucket upload permissions',async()=>{
  const stock=await pool.query<{id:string}>('SELECT id FROM inventory_items WHERE is_active AND total_quantity>0 LIMIT 1');
  if(stock.rowCount){const start=new Date(Date.now()+120*86400000).toISOString().slice(0,10);const booking=await createBooking(pool,{customer_name:'Role test',customer_phone:'0800000000',domain:'BRT',items:[{item_id:stock.rows[0]!.id,quantity:1}],start_date:start,end_date:start});assert.equal((await call(`/api/admin/bookings/${booking.booking_code}/confirm-payment`,'POST',manager,{})).status,403);assert.equal((await call(`/api/admin/bookings/${booking.booking_code}/confirm-payment`,'POST',brt,{})).status,200);await pool.query('DELETE FROM bookings WHERE booking_code=$1',[booking.booking_code]);}
  const upload={bucket:'items',filename:'image.png',mime_type:'image/png',data_base64:'aGVsbG8='};
  assert.equal((await call('/api/admin/media','POST',news,upload)).status,403);
  assert.equal((await call('/api/admin/media','POST',manager,upload)).status,403);
 });
});
