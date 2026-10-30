import {auth,authReady,manageUsers} from './firebase-client.js';
import {signInWithEmailAndPassword,signOut,onAuthStateChanged,sendPasswordResetEmail} from './firebase-sdk.js';
const $ = s => document.querySelector(s);
const escapeHTML = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const normalize = value => value.toLocaleLowerCase('tr-TR').normalize('NFKD').replace(/\p{M}/gu,'').replaceAll('ı','i');
let users=[],page=1,editingId=null,deletingId=null,toastTimer,createRequestId=null,sessionVersion=0;
const pageSize=6;
function toast(message){$('#toast').textContent=message;$('#toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').hidden=true,5000);}
function message(error){const code=error?.code??'';const messages={
 'auth/invalid-credential':'E-posta veya şifre hatalı.', 'auth/user-disabled':'Bu hesap devre dışı.', 'auth/too-many-requests':'Çok fazla deneme. Bir süre sonra tekrar deneyin.',
 'auth/network-request-failed':'Bağlantı kurulamadı. İnternet bağlantınızı kontrol edin.', 'auth/invalid-email':'Geçerli bir e-posta adresi girin.',
 'functions/unauthenticated':'Oturum geçersiz. Çıkış yapıp yeniden giriş yapın.', 'functions/permission-denied':'Bu panel yalnızca uygulama yöneticilerine açıktır.',
 'functions/unavailable':'Yönetim servisine ulaşılamıyor. Tekrar deneyin.', 'functions/internal':'İşlem tamamlanamadı. Listeyi yenileyip durumu kontrol edin.',
 'functions/not-found':'Kullanıcı veya yönetim servisi bulunamadı.'};
 if(['functions/failed-precondition','functions/invalid-argument','functions/already-exists','functions/resource-exhausted'].includes(code))return error.message;
 return messages[code]??'İşlem tamamlanamadı. Bağlantınızı kontrol edip tekrar deneyin.';}
async function loadUsers(){
 const version=sessionVersion;$('#data-message').hidden=false;$('#data-message').textContent='Kullanıcılar Firebase’den yükleniyor…';$('#retry-load').hidden=true;$('#add-user').disabled=true;
 try{let cursor,loaded=[];do{const result=await manageUsers({action:'list',...(cursor?{cursor}:{})});if(version!==sessionVersion)return;loaded.push(...result.users);cursor=result.cursor;}while(cursor);
 users=loaded;render();$('#data-message').hidden=true;$('#add-user').disabled=false;
 }catch(e){if(version!==sessionVersion)return;$('#data-message').textContent=message(e);$('#retry-load').hidden=false;throw e;}
}
function render(){
 const admins=users.filter(u=>u.role==='admin').length;
 $('#total-count').textContent=users.length; $('#admin-count').textContent=admins; $('#user-count').textContent=users.filter(u=>u.role==='user').length; $('#nav-count').textContent=users.length;
 const query=normalize($('#search').value.trim()), filter=$('#role-filter').value;
 const found=users.filter(u=>(filter==='all'||u.role===filter)&&normalize(`${u.name} ${u.email}`).includes(query));
 const pages=Math.max(1,Math.ceil(found.length/pageSize)); page=Math.max(1,Math.min(page,pages));
 $('#list-count').textContent=found.length;
 $('#user-rows').innerHTML=found.slice((page-1)*pageSize,page*pageSize).map((u,i)=>{
 const initials=u.name.trim().split(/\s+/).filter(Boolean).map(s=>Array.from(s)[0]).slice(0,2).join('').toLocaleUpperCase('tr-TR');
 return `<tr><td><div class="user-cell"><span class="avatar" style="background:${['#f0eef8','#eaf3f6','#f8f0e7','#f0f3e9','#fceef0','#eaf3ef'][i]};color:${['#8a79ac','#6b9aaa','#b29770','#91a276','#c4838c','#78a08e'][i]}">${escapeHTML(initials)}</span><div><strong>${escapeHTML(u.name)}</strong><small>${escapeHTML(u.email)}</small></div></div></td><td><span class="badge ${u.role==='admin'?'admin':u.role==='user'?'':'unknown'}"><i></i>${u.deletionPending?'Silme bekliyor':u.role==='admin'?'Uygulama yöneticisi':u.role==='user'?'Standart kullanıcı':'Rol tanımsız'}</span></td><td>${u.createdAt?new Intl.DateTimeFormat('tr-TR',{day:'numeric',month:'short',year:'numeric'}).format(new Date(u.createdAt)):'—'}</td><td><div class="row-actions"><button data-edit="${escapeHTML(u.id)}" aria-label="${escapeHTML(u.name)} bilgilerini ve rolünü düzenle">Düzenle ↗</button><button class="delete" data-delete="${escapeHTML(u.id)}" aria-label="${escapeHTML(u.name)} kullanıcısını sil">Sil</button></div></td></tr>`;
 }).join('');
 $('#empty-state').hidden=found.length>0;
 $('#result-count').textContent=found.length?`${found.length} kullanıcıdan ${(page-1)*pageSize+1}–${Math.min(page*pageSize,found.length)} gösteriliyor`:'0 kullanıcı';
 $('#page-number').textContent=`${page} / ${pages}`; $('#prev-page').disabled=page===1; $('#next-page').disabled=page===pages;
}
function route(){const roles=location.hash==='#roller'; $('#users-page').hidden=roles; $('#roles-page').hidden=!roles; const title=roles?'Roller ve yetkiler':'Kullanıcılar'; $('#page-title').textContent=title; $('#breadcrumb-current').textContent=title; $('#page-description').textContent=roles?'Uygulama rollerini ve erişim kapsamlarını tanıyın.':'Ekibinizi yönetin, doğru kişiye doğru erişimi verin.'; document.querySelectorAll('nav a').forEach(a=>a.classList.toggle('active',a.dataset.page===(roles?'roles':'users')));}

function roleHint(){$('#role-hint').textContent=$('#role').value==='admin'?'Bu rol gerçek uygulamada global yönetim yetkisi verir.':'Standart kullanıcı erişimi atanacak.';}
function openUser(id=null){editingId=id;createRequestId=crypto.randomUUID();$('#user-form').reset();$('#form-error').textContent='';const u=users.find(u=>u.id===id);if(u){$('#name').value=u.name;$('#email').value=u.email;$('#role').value=u.role==='admin'?'admin':'user';}$('#email').disabled=!!u;$('#new-password-label').hidden=!!u;$('#new-password').required=!u;$('#dialog-title').textContent=u?'Kullanıcıyı düzenle':'Kullanıcı ekle';$('#save-user').textContent=u?'Değişiklikleri kaydet':'Kullanıcı ekle';roleHint();$('#user-dialog').showModal();$('#name').focus();}
$('#add-user').addEventListener('click',()=>openUser());document.querySelectorAll('.close-dialog').forEach(b=>b.addEventListener('click',()=>$('#user-dialog').close()));$('#role').addEventListener('change',roleHint);
$('#user-form').addEventListener('submit',async e=>{e.preventDefault();const name=$('#name').value.trim(),email=$('#email').value.trim().toLowerCase(),role=$('#role').value;$('#form-error').textContent='';if(!name){$('#form-error').textContent='Lütfen ad soyad girin.';return;}const old=users.find(u=>u.id===editingId);$('#save-user').disabled=true;
 try{await manageUsers(old?{action:'update',uid:old.id,name,role}:{action:'create',requestId:createRequestId,name,email,role,password:$('#new-password').value});$('#user-dialog').close();$('#new-password').value='';toast(old?'Kullanıcı güncellendi.':'Gerçek uygulama hesabı oluşturuldu.');if(!old){$('#search').value='';$('#role-filter').value='all';page=1;location.hash='#kullanicilar';}await loadUsers();}catch(error){if($('#user-dialog').open)$('#form-error').textContent=message(error);else toast('İşlem tamamlandı, liste yenilenemedi. Tekrar yükle düğmesini kullanın.');}finally{$('#save-user').disabled=false;}
});
$('#user-rows').addEventListener('click',e=>{const edit=e.target.closest('[data-edit]'),del=e.target.closest('[data-delete]');if(edit)openUser(edit.dataset.edit);if(del){deletingId=del.dataset.delete;const u=users.find(u=>u.id===deletingId);$('#delete-description').textContent=`${u.name} (${u.email}) hesabı Firebase Authentication ve kullanıcı profilinden silinecek.`;$('#delete-error').textContent='';$('#delete-dialog').showModal();$('#cancel-delete').focus();}});
$('#cancel-delete').addEventListener('click',()=>$('#delete-dialog').close());
$('#delete-form').addEventListener('submit',async e=>{e.preventDefault();const button=$('#delete-form button[type="submit"]');button.disabled=true;$('#delete-error').textContent='';try{await manageUsers({action:'delete',uid:deletingId});$('#delete-dialog').close();toast('Kullanıcı hesabı silindi.');await loadUsers();}catch(error){if($('#delete-dialog').open)$('#delete-error').textContent=message(error);else toast('Hesap silindi, liste yenilenemedi. Tekrar yükleyin.');}finally{button.disabled=false;}});
$('#search').addEventListener('input',()=>{page=1;render();});$('#role-filter').addEventListener('change',()=>{page=1;render();});$('#clear-filters').addEventListener('click',()=>{$('#search').value='';$('#role-filter').value='all';page=1;render();});$('#prev-page').addEventListener('click',()=>{page--;render();});$('#next-page').addEventListener('click',()=>{page++;render();});
$('#retry-load').addEventListener('click',()=>loadUsers().catch(()=>{}));
 document.querySelectorAll('[data-show-role]').forEach(b=>b.addEventListener('click',()=>{$('#role-filter').value=b.dataset.showRole;$('#search').value='';page=1;location.hash='#kullanicilar';render();}));
window.addEventListener('hashchange',route);document.addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key==='k'&&!document.querySelector('dialog[open]')&&!document.body.classList.contains('auth-pending')){e.preventDefault();location.hash='#kullanicilar';route();$('#search').focus();}});
$('#login-form').addEventListener('submit',async e=>{e.preventDefault();$('#login-error').textContent='';$('#login-submit').disabled=true;try{await authReady;await signInWithEmailAndPassword(auth,$('#login-email').value.trim(),$('#login-password').value);$('#login-password').value='';}catch(error){$('#login-error').textContent=message(error);$('#login-submit').disabled=false;}});
$('#sign-out').addEventListener('click',()=>signOut(auth).catch(e=>toast(message(e))));
$('#reset-password').addEventListener('click',async()=>{const email=$('#login-email');if(!email.reportValidity())return;$('#reset-password').disabled=true;try{await sendPasswordResetEmail(auth,email.value.trim());$('#login-status').textContent='Bu e-postaya ait hesap varsa şifre yenileme bağlantısı gönderildi.';}catch(error){$('#login-error').textContent=message(error);}finally{$('#reset-password').disabled=false;}});
route();render();
try{await authReady;onAuthStateChanged(auth,async user=>{sessionVersion++;const version=sessionVersion;users=[];render();document.querySelectorAll('dialog[open]').forEach(d=>d.close());document.body.classList.add('auth-pending');$('#login-screen').hidden=false;
 if(!user){$('#login-status').textContent='Firebase bağlantısı hazır.';$('#login-submit').disabled=false;return;}
 $('#login-status').textContent='Yönetici yetkisi doğrulanıyor…';$('#login-submit').disabled=true;
 try{await loadUsers();if(version!==sessionVersion)return;document.body.classList.remove('auth-pending');$('#login-screen').hidden=true;$('#current-user-email').textContent=user.email??'Yönetici';$('#login-error').textContent='';}
 catch(error){if(version!==sessionVersion)return;await signOut(auth);$('#login-error').textContent=message(error);$('#login-submit').disabled=false;}
 });}catch(error){$('#login-status').textContent='Oturum depolaması açılamadı. Tarayıcı izinlerini kontrol edin.';$('#login-error').textContent=message(error);}
