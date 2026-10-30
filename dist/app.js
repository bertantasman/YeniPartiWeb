const KEY = 'yeniparti-admin-demo-v1';
const seed = [
  ['Deniz Yılmaz','deniz.yilmaz@example.com','admin','2026-10-12'],
  ['Ece Demir','ece.demir@example.com','user','2026-10-14'],
  ['Mert Kaya','mert.kaya@example.com','user','2026-10-16'],
  ['Selin Arslan','selin.arslan@example.com','admin','2026-10-18'],
  ['Can Aydın','can.aydin@example.com','user','2026-10-20'],
  ['Zeynep Şahin','zeynep.sahin@example.com','user','2026-10-22'],
  ['Emre Çelik','emre.celik@example.com','user','2026-10-25'],
  ['Duru Aksoy','duru.aksoy@example.com','user','2026-10-27'],
].map(([name,email,role,createdAt], i) => ({id:`demo-${i+1}`,name,email,role,createdAt}));
const $ = s => document.querySelector(s);
const escapeHTML = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const normalize = value => value.toLocaleLowerCase('tr-TR').normalize('NFKD').replace(/\p{M}/gu,'').replaceAll('ı','i');
let users = seed, storageIssue = false;
try { const saved = localStorage.getItem(KEY); if (saved !== null) { const parsed=JSON.parse(saved); if(!Array.isArray(parsed)||!parsed.every(u=>u&&typeof u.id==='string'&&typeof u.name==='string'&&typeof u.email==='string'&&['admin','user'].includes(u.role)&&!isNaN(Date.parse(u.createdAt)))) throw Error(); users=parsed; } } catch { storageIssue=true; }
let page=1, editingId=null, deletingId=null, toastTimer;
const pageSize=6;
function toast(message){ $('#toast').textContent=message; $('#toast').hidden=false; clearTimeout(toastTimer); toastTimer=setTimeout(()=>$('#toast').hidden=true,4200); }
function persist(next){try{localStorage.setItem(KEY,JSON.stringify(next)); users=next; return true;}catch{return false;}}
function render(){
 const admins=users.filter(u=>u.role==='admin').length;
 $('#total-count').textContent=users.length; $('#admin-count').textContent=admins; $('#user-count').textContent=users.length-admins; $('#nav-count').textContent=users.length;
 const query=normalize($('#search').value.trim()), filter=$('#role-filter').value;
 const found=users.filter(u=>(filter==='all'||u.role===filter)&&normalize(`${u.name} ${u.email}`).includes(query));
 const pages=Math.max(1,Math.ceil(found.length/pageSize)); page=Math.max(1,Math.min(page,pages));
 $('#list-count').textContent=found.length;
 $('#user-rows').innerHTML=found.slice((page-1)*pageSize,page*pageSize).map((u,i)=>{
 const initials=u.name.trim().split(/\s+/).filter(Boolean).map(s=>Array.from(s)[0]).slice(0,2).join('').toLocaleUpperCase('tr-TR');
 return `<tr><td><div class="user-cell"><span class="avatar" style="background:${['#f0eef8','#eaf3f6','#f8f0e7','#f0f3e9','#fceef0','#eaf3ef'][i]};color:${['#8a79ac','#6b9aaa','#b29770','#91a276','#c4838c','#78a08e'][i]}">${escapeHTML(initials)}</span><div><strong>${escapeHTML(u.name)}</strong><small>${escapeHTML(u.email)}</small></div></div></td><td><span class="badge ${u.role==='admin'?'admin':''}"><i></i>${u.role==='admin'?'Uygulama yöneticisi':'Standart kullanıcı'}</span></td><td>${new Intl.DateTimeFormat('tr-TR',{day:'numeric',month:'short',year:'numeric'}).format(new Date(u.createdAt))}</td><td><div class="row-actions"><button data-edit="${escapeHTML(u.id)}" aria-label="${escapeHTML(u.name)} bilgilerini ve rolünü düzenle">Düzenle ↗</button><button class="delete" data-delete="${escapeHTML(u.id)}" aria-label="${escapeHTML(u.name)} kullanıcısını sil">Sil</button></div></td></tr>`;
 }).join('');
 $('#empty-state').hidden=found.length>0;
 $('#result-count').textContent=found.length?`${found.length} kullanıcıdan ${(page-1)*pageSize+1}–${Math.min(page*pageSize,found.length)} gösteriliyor`:'0 kullanıcı';
 $('#page-number').textContent=`${page} / ${pages}`; $('#prev-page').disabled=page===1; $('#next-page').disabled=page===pages;
}
function route(){const roles=location.hash==='#roller'; $('#users-page').hidden=roles; $('#roles-page').hidden=!roles; const title=roles?'Roller ve yetkiler':'Kullanıcılar'; $('#page-title').textContent=title; $('#breadcrumb-current').textContent=title; $('#page-description').textContent=roles?'Uygulama rollerini ve erişim kapsamlarını tanıyın.':'Ekibinizi yönetin, doğru kişiye doğru erişimi verin.'; document.querySelectorAll('nav a').forEach(a=>a.classList.toggle('active',a.dataset.page===(roles?'roles':'users')));}
function roleHint(){ $('#role-hint').textContent=$('#role').value==='admin'?'Bu rol uygulama genelinde yönetim yetkisi verir.':'Standart kullanıcı erişimi atanacak.'; }
function openUser(id=null){ editingId=id; $('#user-form').reset(); $('#form-error').textContent=''; const u=users.find(u=>u.id===id); if(u){$('#name').value=u.name;$('#email').value=u.email;$('#role').value=u.role;} $('#dialog-title').textContent=u?'Kullanıcıyı düzenle':'Kullanıcı ekle';$('#save-user').textContent=u?'Değişiklikleri kaydet':'Kullanıcı ekle';roleHint();$('#user-dialog').showModal();$('#name').focus(); }
$('#add-user').addEventListener('click',()=>openUser());
document.querySelectorAll('.close-dialog').forEach(b=>b.addEventListener('click',()=>$('#user-dialog').close()));
$('#role').addEventListener('change',roleHint);
$('#user-form').addEventListener('submit',e=>{e.preventDefault();const name=$('#name').value.trim(),email=$('#email').value.trim().toLowerCase(),role=$('#role').value;const fail=m=>$('#form-error').textContent=m;
 if(!name)return fail('Lütfen ad soyad girin.');
 if(!['admin','user'].includes(role))return fail('Geçerli bir rol seçin.');
 if(users.some(u=>u.id!==editingId&&u.email.toLowerCase()===email))return fail('Bu e-posta adresi zaten kayıtlı.');
 const old=users.find(u=>u.id===editingId);
 if(old?.role==='admin'&&role!=='admin'&&users.filter(u=>u.role==='admin').length===1)return fail('Son uygulama yöneticisinin rolü değiştirilemez. Önce başka bir yönetici atayın.');
 const user={id:old?.id??crypto.randomUUID(),name,email,role,createdAt:old?.createdAt??new Date().toISOString()};
 const next=old?users.map(u=>u.id===old.id?user:u):[user,...users];
 if(!persist(next))return fail('Tarayıcıya kaydedilemedi. Depolama izinlerini kontrol edip tekrar deneyin.');
 if(!old){$('#search').value='';$('#role-filter').value='all';page=1;location.hash='#kullanicilar';}
 $('#user-dialog').close();render();toast(old?'Kullanıcı bilgileri ve rolü güncellendi.':'Kullanıcı eklendi.');
});
$('#user-rows').addEventListener('click',e=>{const edit=e.target.closest('[data-edit]'),del=e.target.closest('[data-delete]');if(edit)openUser(edit.dataset.edit);if(del){deletingId=del.dataset.delete;const u=users.find(u=>u.id===deletingId);$('#delete-description').textContent=`${u.name} (${u.email}) adlı kullanıcı panelden silinecek.`;$('#delete-error').textContent='';$('#delete-dialog').showModal();$('#cancel-delete').focus();}});
$('#cancel-delete').addEventListener('click',()=>$('#delete-dialog').close());
$('#delete-form').addEventListener('submit',e=>{e.preventDefault();const u=users.find(u=>u.id===deletingId);if(u?.role==='admin'&&users.filter(u=>u.role==='admin').length===1){$('#delete-error').textContent='Son uygulama yöneticisi silinemez. Önce başka bir yönetici atayın.';return;}if(!persist(users.filter(u=>u.id!==deletingId))){$('#delete-error').textContent='Silme işlemi kaydedilemedi. Tekrar deneyin.';return;}$('#delete-dialog').close();render();toast('Kullanıcı silindi.');});
$('#search').addEventListener('input',()=>{page=1;render();});$('#role-filter').addEventListener('change',()=>{page=1;render();});$('#clear-filters').addEventListener('click',()=>{$('#search').value='';$('#role-filter').value='all';page=1;render();});
$('#prev-page').addEventListener('click',()=>{page--;render();});$('#next-page').addEventListener('click',()=>{page++;render();});
document.querySelectorAll('[data-show-role]').forEach(b=>b.addEventListener('click',()=>{$('#role-filter').value=b.dataset.showRole;$('#search').value='';page=1;location.hash='#kullanicilar';render();}));
window.addEventListener('hashchange',route);window.addEventListener('storage',e=>{if(e.key===KEY)location.reload();});
document.addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key==='k'&&!document.querySelector('dialog[open]')){e.preventDefault();location.hash='#kullanicilar';route();$('#search').focus();}});
route();render();if(storageIssue)toast('Kaydedilen veriler okunamadı. Örnek liste gösteriliyor.');
