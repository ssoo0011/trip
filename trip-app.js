const TRIP_DB='trip-pxl-db',TRIP_STORE='trip-pxl-state',TRIP_KEY='current';
const EMPTY_STATE={trips:[{id:'trip-default',name:'내 첫 여행'}],activeTripId:'trip-default',expenses:[],places:[],dates:[],schedule:[],categories:{expenses:['숙소','식비','교통','쇼핑','기타'],places:['관광','식사','이동','휴식','기타']}};
let state=structuredClone(EMPTY_STATE),dbPromise,editingTripId=null,categoryMode='expenses',calendarCursor=new Date(),draftStart='',draftEnd='',hasUnsavedChanges=false,save;
const $=selector=>document.querySelector(selector);const escapeHtml=value=>String(value??'').replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#039;','"':'&quot;'}[char]));const uid=()=>`${Date.now()}-${Math.random().toString(36).slice(2,8)}`;const money=value=>new Intl.NumberFormat('ko-KR',{style:'currency',currency:'KRW',maximumFractionDigits:0}).format(Number(value)||0);
function openDb(){if(dbPromise)return dbPromise;dbPromise=new Promise((resolve,reject)=>{const request=indexedDB.open(TRIP_DB,1);request.onupgradeneeded=()=>request.result.createObjectStore(TRIP_STORE);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});return dbPromise;}
async function persistState(){try{const db=await openDb();await new Promise((resolve,reject)=>{const tx=db.transaction(TRIP_STORE,'readwrite');tx.objectStore(TRIP_STORE).put(state,TRIP_KEY);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});hasUnsavedChanges=false;updateSaveStatus('저장됨');}catch(error){updateSaveStatus('저장 실패');}}
function unique(values,fallback){const list=Array.isArray(values)?values.filter(value=>typeof value==='string'&&value.trim()):[];return[...new Set([...list,...fallback])];}
function normalize(input){const incoming=input||{},oldDestinations=Array.isArray(incoming.trips)?incoming.trips:(Array.isArray(incoming.destinations)?incoming.destinations:[]),trips=oldDestinations.length?oldDestinations.filter(item=>item&&item.id&&item.name).map(item=>({id:String(item.id),name:String(item.name),startDate:String(item.startDate||''),endDate:String(item.endDate||'')})):structuredClone(EMPTY_STATE.trips),fallback=trips[0].id,oldTrip=item=>item?.tripId||item?.destinationId||fallback,places=Array.isArray(incoming.places)?incoming.places.filter(item=>item&&item.name).map(item=>({id:String(item.id||uid()),tripId:oldTrip(item),name:String(item.name),category:String(item.category||'기타')})):[],dates=Array.isArray(incoming.dates)?incoming.dates.filter(item=>item&&item.value).map(item=>({id:String(item.id||uid()),tripId:oldTrip(item),value:String(item.value)})):[],rawPlans=Array.isArray(incoming.schedule)?incoming.schedule:(Array.isArray(incoming.plans)?incoming.plans:[]),schedule=rawPlans.filter(item=>item&&((item.title||item.name)||item.place)).map(item=>{const tripId=oldTrip(item),placeName=item.place||item.name||item.title||'장소';let placeId=item.placeId||'';if(!placeId){const existing=places.find(place=>place.tripId===tripId&&place.name===placeName);placeId=existing?.id||uid();if(!existing)places.push({id:placeId,tripId,name:placeName,category:item.category||'기타'});}let dateId=item.dateId||'';if(!dateId&&item.date){const existingDate=dates.find(date=>date.tripId===tripId&&date.value===item.date);dateId=existingDate?.id||uid();if(!existingDate)dates.push({id:dateId,tripId,value:String(item.date)});}return{id:String(item.id||uid()),tripId,dateId,placeId,order:Number.isFinite(item.order)?item.order:0};}),expenses=Array.isArray(incoming.expenses)?incoming.expenses.filter(item=>item&&item.title).map(item=>({...item,id:String(item.id||uid()),tripId:oldTrip(item)})):[];return{trips,activeTripId:trips.some(item=>item.id===incoming.activeTripId)?incoming.activeTripId:fallback,expenses,places,dates,schedule,categories:{expenses:unique(incoming.categories?.expenses,EMPTY_STATE.categories.expenses),places:unique(incoming.categories?.places||incoming.categories?.plans,EMPTY_STATE.categories.places)}};}
function currentTrip(){return state.trips.find(trip=>trip.id===state.activeTripId)||state.trips[0];}function tripExpenses(){return state.expenses.filter(item=>item.tripId===state.activeTripId)}function tripPlaces(){return state.places.filter(item=>item.tripId===state.activeTripId)}function tripDates(){return state.dates.filter(item=>item.tripId===state.activeTripId)}function tripSchedule(){return state.schedule.filter(item=>item.tripId===state.activeTripId)}
function isoDate(date){return`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;}
function dateLabelFromIso(value){const parts=String(value||'').split('-');return parts.length===3?`${parts[0]}.${parts[1]}.${parts[2]}`:String(value||'');}
function parseDateValue(value){const digits=String(value||'').replace(/\D/g,'');if(digits.length<8)return'';return`${digits.slice(0,4)}-${digits.slice(4,6)}-${digits.slice(6,8)}`;}
function dateRange(start,end){if(!start||!end)return[];const from=new Date(`${start}T00:00:00`),to=new Date(`${end}T00:00:00`);if(Number.isNaN(from.getTime())||Number.isNaN(to.getTime()))return[];const result=[];for(const cursor=new Date(from);cursor<=to;cursor.setDate(cursor.getDate()+1))result.push(isoDate(cursor));return result;}
function ensureTripDateSections(trip){if(!trip?.startDate||!trip?.endDate)return;const start=parseDateValue(trip.startDate),end=parseDateValue(trip.endDate);dateRange(start,end).forEach(value=>{const label=dateLabelFromIso(value);if(!state.dates.some(date=>date.tripId===trip.id&&String(date.value).replace(/\D/g,'')===label.replace(/\D/g,'')))state.dates.push({id:uid(),tripId:trip.id,value:label});});}
function renderCalendar(){const grid=$('#calendarGrid'),month=$('#calendarMonth'),label=$('#rangeLabel'),hint=$('#calendarHint');if(!grid||!month||!label||!hint)return;const trip=currentTrip(),savedStart=parseDateValue(trip?.startDate),savedEnd=parseDateValue(trip?.endDate);label.textContent=draftStart&&draftEnd?`${dateLabelFromIso(draftStart)} – ${dateLabelFromIso(draftEnd)}`:draftStart?`${dateLabelFromIso(draftStart)} – 종료일 선택`:savedStart&&savedEnd?`${dateLabelFromIso(savedStart)} – ${dateLabelFromIso(savedEnd)}`:'기간을 선택하세요';month.textContent=`${calendarCursor.getFullYear()}년 ${calendarCursor.getMonth()+1}월`;hint.textContent=draftStart&&!draftEnd?'종료일을 선택하세요':'시작일을 선택하세요';const year=calendarCursor.getFullYear(),monthIndex=calendarCursor.getMonth(),first=new Date(year,monthIndex,1),offset=first.getDay(),days=new Date(year,monthIndex+1,0).getDate();let html=Array.from({length:offset},()=>'<span class="calendar-empty"></span>').join('');for(let day=1;day<=days;day+=1){const value=isoDate(new Date(year,monthIndex,day)),inRange=draftStart&&draftEnd&&value>draftStart&&value<draftEnd;html+=`<button class="calendar-day${value===draftStart?' start':''}${value===draftEnd?' end':''}${inRange?' in-range':''}" type="button" data-calendar-day="${value}">${day}</button>`;}grid.innerHTML=html;}
function setupCalendarPicker(){const oldForm=$('#dateForm'),head=document.querySelector('.schedule-head');if(!oldForm||!head||$('#datePicker'))return;const trigger=document.createElement('button');trigger.className='range-trigger';trigger.type='button';trigger.id='rangeTrigger';trigger.innerHTML='<span>여행 기간</span><strong id="rangeLabel">기간을 선택하세요</strong><b>⌄</b>';oldForm.replaceWith(trigger);const picker=document.createElement('div');picker.className='date-picker-popover';picker.id='datePicker';picker.hidden=true;picker.innerHTML='<div class="calendar-header"><button type="button" data-calendar-prev aria-label="이전 달">‹</button><strong id="calendarMonth"></strong><button type="button" data-calendar-next aria-label="다음 달">›</button></div><div class="calendar-weekdays"><span>일</span><span>월</span><span>화</span><span>수</span><span>목</span><span>금</span><span>토</span></div><div class="calendar-grid" id="calendarGrid"></div><p class="calendar-hint" id="calendarHint"></p><div class="date-picker-actions"><button class="outline-button" type="button" data-calendar-cancel>취소</button><button class="gradient-button" type="button" data-calendar-apply>기간 적용</button></div>';head.append(picker);const trip=currentTrip();draftStart=parseDateValue(trip?.startDate);draftEnd=parseDateValue(trip?.endDate);const initial=draftStart?new Date(`${draftStart}T00:00:00`):new Date();calendarCursor=new Date(initial.getFullYear(),initial.getMonth(),1);renderCalendar();trigger.addEventListener('click',()=>{const opening=picker.hidden;picker.hidden=!opening;if(opening){draftStart=parseDateValue(currentTrip()?.startDate);draftEnd=parseDateValue(currentTrip()?.endDate);renderCalendar();}});picker.addEventListener('click',event=>{const day=event.target.closest('[data-calendar-day]');if(day){const value=day.dataset.calendarDay;if(!draftStart||draftEnd){draftStart=value;draftEnd='';}else if(value<draftStart){draftEnd=draftStart;draftStart=value;}else{draftEnd=value;}renderCalendar();return;}if(event.target.closest('[data-calendar-prev]')){calendarCursor=new Date(calendarCursor.getFullYear(),calendarCursor.getMonth()-1,1);renderCalendar();return;}if(event.target.closest('[data-calendar-next]')){calendarCursor=new Date(calendarCursor.getFullYear(),calendarCursor.getMonth()+1,1);renderCalendar();return;}if(event.target.closest('[data-calendar-cancel]')){picker.hidden=true;return;}if(event.target.closest('[data-calendar-apply]')){if(!draftStart||!draftEnd){toast('시작일과 종료일을 선택하세요.');return;}const active=currentTrip();active.startDate=dateLabelFromIso(draftStart);active.endDate=dateLabelFromIso(draftEnd);ensureTripDateSections(active);save();picker.hidden=true;renderDetailContent();renderCalendar();toast('여행 기간과 날짜 섹션을 만들었어요.');}});}
function toast(message){const node=$('#toast');if(!node)return;node.textContent=message;node.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>node.classList.remove('show'),2200);}
function updateSaveStatus(label){document.querySelectorAll('#saveStatus').forEach(status=>{status.textContent=label;});}
function markUnsaved(){hasUnsavedChanges=true;updateSaveStatus('저장되지 않음');}
function header(){return`<header class="trip-header"><div class="trip-header-brand"><a class="trip-brand" href="#" data-back-list><span class="brand-orb"></span><span>내 여행</span></a><button class="header-nav-toggle header-nav-toggle-desktop" type="button" data-side-nav-toggle aria-expanded="${String(!sideNavCollapsed)}" aria-label="${sideNavCollapsed?'네비게이션 펼치기':'네비게이션 접기'}" title="${sideNavCollapsed?'네비게이션 펼치기':'네비게이션 접기'}">${sideNavToggleIcon}<span class="side-nav-toggle-label">${sideNavCollapsed?'펼치기':'접기'}</span></button><button class="header-nav-toggle header-nav-toggle-mobile" type="button" data-mobile-nav-toggle aria-expanded="false" aria-label="네비게이션 열기" title="네비게이션 열기">☰</button></div><div class="header-tools"><span class="save-status" id="saveStatus">${hasUnsavedChanges?'저장되지 않음':'저장됨'}</span><button class="save-trip-button" type="button" data-save-trip>여행 저장</button><button class="header-icon" type="button" data-export aria-label="JSON 내보내기">↥</button><button class="header-icon" type="button" data-import aria-label="JSON 가져오기">↧</button><input id="importFile" type="file" accept="application/json,.json" hidden /></div></header>`;}
function renderTripList(){document.body.innerHTML=`<div class="trip-app">${header()}<main class="trip-list-page"><section class="list-intro"><div><p class="eyebrow">TRAVEL COLLECTION</p><h1>내 여행</h1><p>여행지를 선택하면 그 안에서 경비와 계획을 함께 관리할 수 있어요.</p></div><button class="gradient-button" type="button" data-new-trip>＋ 여행지 등록</button></section><section class="trip-grid" id="tripGrid">${state.trips.map((trip,index)=>{const expenses=state.expenses.filter(item=>item.tripId===trip.id),schedule=state.schedule.filter(item=>item.tripId===trip.id),total=expenses.reduce((sum,item)=>sum+Number(item.amount||0),0);return`<article class="trip-card" data-trip-id="${trip.id}"><span class="trip-card-accent"></span><div class="trip-card-top"><span class="trip-card-number">${String(index+1).padStart(2,'0')}</span><button class="trip-card-edit" type="button" data-edit-trip="${trip.id}" aria-label="${escapeHtml(trip.name)} 이름 수정">✎</button></div><h2>${escapeHtml(trip.name)}</h2><div class="trip-card-meta"><span>${schedule.length}개 일정</span><span>${money(total)}</span></div></article>`;}).join('')||'<div class="empty-page"><strong>아직 여행지가 없어요</strong>첫 여행지를 등록해보세요.</div>'}</section><footer class="trip-footer">여행지별로 기록이 나뉘어 안전하게 정리돼요.</footer></main>${tripModals()}</div>`;bindListEvents();}
function tripModals(){return`<dialog class="trip-modal" id="tripModal"><form class="modal-box" id="tripForm"><button class="modal-close" type="button" data-close-modal>×</button><p class="eyebrow">TRAVEL NAME</p><h2 id="tripModalTitle">여행지 등록</h2><p>여행지 이름을 정하면 그 안에 경비와 계획이 저장돼요.</p><input class="modal-input" id="tripName" type="text" placeholder="예: 오사카 여행" maxlength="40" /><div class="modal-actions"><button class="outline-button" type="button" data-close-modal>취소</button><button class="gradient-button" type="submit">저장하기</button></div></form></dialog><dialog class="trip-modal" id="categoryModal"><form class="modal-box" id="categoryForm"><button class="modal-close" type="button" data-close-modal>×</button><p class="eyebrow">CATEGORY</p><h2 id="categoryTitle">카테고리</h2><p>자주 쓰는 분류를 추가하거나 정리하세요.</p><div class="modal-actions"><input class="modal-input" id="categoryName" type="text" placeholder="새 카테고리 이름" /><button class="small-plus" id="addCategory" type="button">＋</button></div><div class="category-list" id="categoryList"></div><div class="modal-actions"><button class="gradient-button" type="button" data-close-modal>완료</button></div></form></dialog><div class="toast" id="toast" role="status" aria-live="polite"></div>`;}
function renderDetail(){const trip=currentTrip(),expenses=tripExpenses(),total=expenses.reduce((sum,item)=>sum+Number(item.amount||0),0);document.body.innerHTML=`<div class="trip-app">${header()}<main class="trip-detail-page"><div class="detail-topbar"><button class="back-button" type="button" data-back-list>← 내 여행 목록</button></div><section class="detail-title-wrap"><div><p class="eyebrow">TRIP SPACE</p><h1>${escapeHtml(trip.name)}</h1><p>이 여행의 장소, 경비, 일정을 한곳에서 정리해요.</p></div><button class="outline-button" type="button" data-edit-current-trip>여행지명 수정</button></section><div class="detail-layout"><aside class="left-stack"><section class="detail-card places-card"><div class="detail-card-head"><div><p>PLACE LIBRARY</p><h2>장소 등록</h2></div><span class="section-icon">＋</span></div><form id="placeForm" class="detail-form"><label>장소 이름<input name="name" type="text" placeholder="예: 도톤보리" required /></label><div class="detail-form"><label>카테고리<div class="manage-row"><select name="category" id="placeCategory"></select><button class="small-plus" type="button" data-open-category="places">＋</button></div></label></div><button class="gradient-button" type="submit">장소 저장</button></form><div class="saved-place-list" id="placeList"></div></section><section class="detail-card"><div class="detail-card-head"><div><p>EXPENSES</p><h2>경비</h2></div><strong class="expense-total" id="expenseTotal">${money(total)}</strong></div><form id="expenseForm" class="detail-form"><label>항목<input name="title" type="text" placeholder="예: 숙소" required /></label><label>금액<input name="amount" type="number" placeholder="0" /></label><div class="manage-row"><select name="category" id="expenseCategory"></select><button class="small-plus" type="button" data-open-category="expenses">＋</button></div><button class="gradient-button" type="submit">경비 저장</button></form><div class="expense-list" id="expenseList"></div></section></aside><section class="detail-card schedule-card"><div class="schedule-head"><div><p>SCHEDULE BOARD</p><h2>여행 일정</h2><p>날짜를 추가한 뒤 왼쪽 장소를 끌어 넣으세요.</p></div><form class="date-add-form" id="dateForm"><input name="date" type="text" inputmode="numeric" placeholder="날짜 추가 · 2026.08.04" autocomplete="off" /><button type="submit" aria-label="날짜 추가">＋</button></form></div><div class="date-sections" id="dateSections"></div><p class="trip-drop-note">장소를 일정에 넣으려면 왼쪽 장소 항목을 날짜 섹션으로 드래그하세요. 일정 안에서도 순서를 옮길 수 있어요.</p></section></div></main>${tripModals()}</div>`;bindDetailEvents();renderDetailContent();}
function renderDetailContent(){const places=tripPlaces(),expenses=tripExpenses(),dates=tripDates(),schedule=tripSchedule();const categoryPlaces=places.reduce((map,item)=>(map[item.category]??=[]).push(item)&&map,{});$('#placeCategory').innerHTML=state.categories.places.map(item=>`<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join('');$('#expenseCategory').innerHTML=state.categories.expenses.map(item=>`<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join('');$('#placeList').innerHTML=places.length?Object.entries(categoryPlaces).map(([category,items])=>items.map(place=>`<div class="saved-place" draggable="true" data-place-id="${place.id}"><span class="place-dot"></span><span class="saved-place-name">${escapeHtml(place.name)}</span><span class="saved-place-category">${escapeHtml(category)}</span><button class="mini-delete" type="button" data-delete-place="${place.id}" aria-label="${escapeHtml(place.name)} 삭제">×</button></div>`).join('')).join(''):'<div class="empty-small">저장한 장소가 없어요.</div>';const total=expenses.reduce((sum,item)=>sum+Number(item.amount||0),0);$('#expenseTotal').textContent=money(total);$('#expenseList').innerHTML=expenses.length?expenses.map(item=>`<div class="expense-row"><div><div class="expense-name">${escapeHtml(item.title)}</div><div class="expense-meta">${escapeHtml(item.category)}</div></div><span class="expense-amount">${money(item.amount)}</span><button class="mini-delete" type="button" data-delete-expense="${item.id}" aria-label="${escapeHtml(item.title)} 삭제">×</button></div>`).join(''):'<div class="empty-small">아직 경비가 없어요.</div>';$('#dateSections').innerHTML=dates.length?dates.map(date=>{const rows=schedule.filter(item=>item.dateId===date.id).sort((a,b)=>(a.order||0)-(b.order||0));return`<section class="date-section" data-date-section="${date.id}"><div class="date-section-head"><div><h3>${escapeHtml(date.value)}</h3><span>${rows.length}개 장소</span></div><button class="mini-delete" type="button" data-delete-date="${date.id}" aria-label="${escapeHtml(date.value)} 날짜 삭제">×</button></div><div class="date-dropzone" data-date-dropzone="${date.id}">${rows.length?rows.map((item,index)=>{const place=places.find(saved=>saved.id===item.placeId);return place?`<div class="schedule-row" draggable="true" data-schedule-id="${item.id}"><span class="schedule-order">${String(index+1).padStart(2,'0')}</span><div><div class="schedule-name">${escapeHtml(place.name)}</div><div class="schedule-meta">${escapeHtml(place.category)}</div></div><span class="schedule-chip">장소</span><button class="schedule-remove" type="button" data-remove-schedule="${item.id}" aria-label="${escapeHtml(place.name)} 일정에서 제거">×</button></div>`:''}).join(''):'<div class="drop-hint">왼쪽 장소를 이 날짜로 끌어오세요.</div>'}</div></section>`;}).join(''):'<div class="empty-small">위에서 날짜를 먼저 추가하세요.</div>';}
function openTripForm(id){editingTripId=id||null;$('#tripModalTitle').textContent=editingTripId?'여행지명 수정':'여행지 등록';$('#tripName').value=editingTripId?state.trips.find(item=>item.id===editingTripId)?.name||'':'';$('#tripModal').showModal();$('#tripName').focus();}
function openCategory(type){categoryMode=type;$('#categoryTitle').textContent=type==='expenses'?'경비 카테고리':'장소 카테고리';$('#categoryList').innerHTML=state.categories[type].map(item=>`<div class="category-row"><span>${escapeHtml(item)}</span><button class="category-remove" type="button" data-delete-category="${escapeHtml(item)}" ${item==='기타'?'disabled':''}>×</button></div>`).join('');$('#categoryModal').showModal();}
function exportState(){const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`my-trip-${new Date().toISOString().slice(0,10)}.json`;link.click();URL.revokeObjectURL(url);toast('여행 데이터를 내보냈어요.');}
async function importState(file){if(!file)return;try{state=normalize(JSON.parse(await file.text()));await save();renderTripList();toast('여행 데이터를 가져왔어요.');}catch(error){toast('JSON 파일을 읽지 못했어요.');}}
function bindGlobalEvents(){document.addEventListener('click',event=>{const saveButton=event.target.closest('[data-save-trip]');if(saveButton){saveButton.disabled=true;commitState().then(()=>toast(hasUnsavedChanges?'저장에 실패했어요.':'여행을 저장했어요.')).finally(()=>{saveButton.disabled=false;});return;}const back=event.target.closest('[data-back-list]');if(back){renderTripList();return;}const card=event.target.closest('[data-trip-id]');if(card&&!event.target.closest('[data-edit-trip]')){state.activeTripId=card.dataset.tripId;save();renderDetail();return;}const edit=event.target.closest('[data-edit-trip]');if(edit){openTripForm(edit.dataset.editTrip);return;}const newTrip=event.target.closest('[data-new-trip]');if(newTrip){openTripForm();return;}const close=event.target.closest('[data-close-modal]');if(close){close.closest('dialog')?.close();return;}const exportButton=event.target.closest('[data-export]');if(exportButton){exportState();return;}const importButton=event.target.closest('[data-import]');if(importButton){$('#importFile').click();return;}});document.addEventListener('change',event=>{if(event.target.id==='importFile')importState(event.target.files[0]);});}
function bindListEvents(){$('#tripForm').addEventListener('submit',event=>{event.preventDefault();const name=$('#tripName').value.trim();if(!name)return;if(editingTripId){const trip=state.trips.find(item=>item.id===editingTripId);if(trip)trip.name=name;}else{const trip={id:uid(),name};state.trips.push(trip);state.activeTripId=trip.id;}$('#tripModal').close();save();renderTripList();toast(editingTripId?'여행지명을 수정했어요.':'여행지를 등록했어요.');});}
function bindDetailEvents(){$('#placeForm').addEventListener('submit',event=>{event.preventDefault();const form=new FormData(event.currentTarget),name=String(form.get('name')||'').trim();if(!name)return;state.places.push({id:uid(),tripId:state.activeTripId,name,category:form.get('category')});event.currentTarget.reset();save();renderDetailContent();toast('장소를 저장했어요.');});$('#expenseForm').addEventListener('submit',event=>{event.preventDefault();const form=new FormData(event.currentTarget);state.expenses.push({id:uid(),tripId:state.activeTripId,title:String(form.get('title')||'').trim(),amount:Number(form.get('amount'))||0,category:form.get('category')});event.currentTarget.reset();save();renderDetailContent();toast('경비를 저장했어요.');});$('#dateForm').addEventListener('submit',event=>{event.preventDefault();const value=String(new FormData(event.currentTarget).get('date')||'').trim();if(!value)return;state.dates.push({id:uid(),tripId:state.activeTripId,value});event.currentTarget.reset();save();renderDetailContent();toast('날짜 섹션을 추가했어요.');});document.addEventListener('click',event=>{const edit=event.target.closest('[data-edit-current-trip]');if(edit){openTripForm(state.activeTripId);return;}const openCategoryButton=event.target.closest('[data-open-category]');if(openCategoryButton){openCategory(openCategoryButton.dataset.openCategory);return;}const deletePlace=event.target.closest('[data-delete-place]');if(deletePlace){state.places=state.places.filter(item=>item.id!==deletePlace.dataset.deletePlace);state.schedule=state.schedule.filter(item=>item.placeId!==deletePlace.dataset.deletePlace);save();renderDetailContent();return;}const deleteExpense=event.target.closest('[data-delete-expense]');if(deleteExpense){state.expenses=state.expenses.filter(item=>item.id!==deleteExpense.dataset.deleteExpense);save();renderDetailContent();return;}const deleteDate=event.target.closest('[data-delete-date]');if(deleteDate){state.dates=state.dates.filter(item=>item.id!==deleteDate.dataset.deleteDate);state.schedule=state.schedule.filter(item=>item.dateId!==deleteDate.dataset.deleteDate);save();renderDetailContent();return;}const removeSchedule=event.target.closest('[data-remove-schedule]');if(removeSchedule){state.schedule=state.schedule.filter(item=>item.id!==removeSchedule.dataset.removeSchedule);save();renderDetailContent();return;}const deleteCategory=event.target.closest('[data-delete-category]');if(deleteCategory&&deleteCategory.dataset.deleteCategory!=='기타'){state.categories[categoryMode]=state.categories[categoryMode].filter(item=>item!==deleteCategory.dataset.deleteCategory);$('#categoryModal').close();save();renderDetailContent();}});$('#addCategory').addEventListener('click',()=>{const input=$('#categoryName'),value=input.value.trim();if(!value||state.categories[categoryMode].includes(value))return;state.categories[categoryMode].push(value);input.value='';openCategory(categoryMode);save();});document.addEventListener('dragstart',event=>{const place=event.target.closest('[data-place-id]'),schedule=event.target.closest('[data-schedule-id]');if(place){event.dataTransfer.setData('text/plain',`place:${place.dataset.placeId}`);place.classList.add('dragging');}else if(schedule){event.dataTransfer.setData('text/plain',`schedule:${schedule.dataset.scheduleId}`);schedule.classList.add('dragging');}});document.addEventListener('dragend',event=>{event.target.closest('[data-place-id], [data-schedule-id]')?.classList.remove('dragging');});document.addEventListener('dragover',event=>{const zone=event.target.closest('[data-date-dropzone]');if(zone){event.preventDefault();zone.classList.add('drag-over');}});document.addEventListener('dragleave',event=>{event.target.closest('[data-date-dropzone]')?.classList.remove('drag-over');});document.addEventListener('drop',event=>{const zone=event.target.closest('[data-date-dropzone]');if(!zone)return;event.preventDefault();zone.classList.remove('drag-over');const payload=event.dataTransfer.getData('text/plain'),[type,id]=payload.split(':');if(type==='place'&&!state.schedule.some(item=>item.dateId===zone.dataset.dateDropzone&&item.placeId===id)){state.schedule.push({id:uid(),tripId:state.activeTripId,dateId:zone.dataset.dateDropzone,placeId:id,order:state.schedule.filter(item=>item.dateId===zone.dataset.dateDropzone).length});save();renderDetailContent();toast('장소를 일정에 추가했어요.');}if(type==='schedule'){const item=state.schedule.find(schedule=>schedule.id===id);if(item){item.dateId=zone.dataset.dateDropzone;item.order=state.schedule.filter(schedule=>schedule.dateId===zone.dataset.dateDropzone).length;save();renderDetailContent();toast('일정을 옮겼어요.');}}});}
function start(){const link=document.createElement('link');link.rel='stylesheet';link.href='trip.css';document.head.append(link);bindGlobalEvents();try{const request=indexedDB.open(TRIP_DB,1);request.onsuccess=()=>{const db=request.result,read=db.transaction(TRIP_STORE,'readonly').objectStore(TRIP_STORE).get(TRIP_KEY);read.onsuccess=()=>{if(read.result)state=normalize(read.result);renderTripList();};read.onerror=()=>renderTripList();};request.onerror=()=>renderTripList();}catch(error){renderTripList();}}
const baseRenderDetail=renderDetail;
renderDetail=function(){ensureTripDateSections(currentTrip());baseRenderDetail();setupCalendarPicker();};
const baseRenderTripList=renderTripList;
renderTripList=function(){if(document.body.dataset.page==='detail'){const requestedTripId=new URLSearchParams(window.location.search).get('trip');if(requestedTripId&&!state.trips.some(trip=>trip.id===requestedTripId)){window.location.href='index.html';return;}if(requestedTripId)state.activeTripId=requestedTripId;renderDetail();return;}baseRenderTripList();};
importState=async function(file){if(!file)return;try{state=normalize(JSON.parse(await file.text()));await save();if(document.body.dataset.page==='detail')renderDetail();else renderTripList();toast('여행 데이터를 가져왔어요.');}catch(error){toast('JSON 파일을 읽지 못했어요.');}};
bindGlobalEvents=function(){document.addEventListener('click',event=>{const saveButton=event.target.closest('[data-save-trip]');if(saveButton){saveButton.disabled=true;commitState().then(()=>toast(hasUnsavedChanges?'저장에 실패했어요.':'여행을 저장했어요.')).finally(()=>{saveButton.disabled=false;});return;}const back=event.target.closest('[data-back-list]');if(back){window.location.href='index.html';return;}const card=event.target.closest('[data-trip-id]');if(card&&!event.target.closest('[data-edit-trip]')){state.activeTripId=card.dataset.tripId;save();window.location.href=`trip.html?trip=${encodeURIComponent(card.dataset.tripId)}`;return;}const edit=event.target.closest('[data-edit-trip]');if(edit){openTripForm(edit.dataset.editTrip);return;}const newTrip=event.target.closest('[data-new-trip]');if(newTrip){openTripForm();return;}const close=event.target.closest('[data-close-modal]');if(close){close.closest('dialog')?.close();return;}const exportButton=event.target.closest('[data-export]');if(exportButton){exportState();return;}const importButton=event.target.closest('[data-import]');if(importButton){$('#importFile').click();return;}});document.addEventListener('change',event=>{if(event.target.id==='importFile')importState(event.target.files[0]);});};
function renderScheduleTables(){const places=tripPlaces(),dates=tripDates(),schedule=tripSchedule(),sections=$('#dateSections');if(!sections)return;sections.innerHTML=dates.length?dates.map(date=>{const rows=schedule.filter(item=>item.dateId===date.id).sort((a,b)=>(a.order||0)-(b.order||0));return`<section class="date-section" data-date-section="${date.id}"><div class="date-section-head"><div><h3>${escapeHtml(date.value)}</h3><span>${rows.length}개 장소</span></div><button class="mini-delete" type="button" data-delete-date="${date.id}" aria-label="${escapeHtml(date.value)} 날짜 삭제">×</button></div><div class="date-dropzone schedule-dropzone" data-date-dropzone="${date.id}"><table class="schedule-table"><thead><tr><th class="schedule-col-order">순번</th><th class="schedule-col-time">시간</th><th class="schedule-col-place">장소명</th><th class="schedule-col-address">주소</th><th class="schedule-col-cost">소요금액</th><th class="schedule-col-stay">체류시간</th><th class="schedule-col-transport">교통</th><th class="schedule-col-action" aria-label="삭제"></th></tr></thead><tbody>${rows.length?rows.map((item,index)=>{const place=places.find(saved=>saved.id===item.placeId);return place?`<tr class="schedule-table-row" draggable="true" data-schedule-id="${item.id}"><td class="schedule-col-order"><span class="schedule-order">${String(index+1).padStart(2,'0')}</span></td><td class="schedule-col-time"><input class="schedule-cell-input" data-schedule-id="${item.id}" data-schedule-field="time" type="text" inputmode="numeric" placeholder="09:00" value="${escapeHtml(item.time||'')}" /></td><td class="schedule-col-place"><strong>${escapeHtml(place.name)}</strong><small>${escapeHtml(place.category)}</small></td><td class="schedule-col-address"><input class="schedule-cell-input" data-schedule-id="${item.id}" data-schedule-field="address" type="text" placeholder="주소 입력" value="${escapeHtml(item.address||'')}" /></td><td class="schedule-col-cost"><input class="schedule-cell-input cost-input" data-schedule-id="${item.id}" data-schedule-field="cost" type="number" inputmode="numeric" min="0" placeholder="0" value="${escapeHtml(item.cost??'')}" /></td><td class="schedule-col-stay"><input class="schedule-cell-input" data-schedule-id="${item.id}" data-schedule-field="stay" type="text" placeholder="90분" value="${escapeHtml(item.stay||'')}" /></td><td class="schedule-col-transport"><input class="schedule-cell-input" data-schedule-id="${item.id}" data-schedule-field="transport" type="text" placeholder="도보" value="${escapeHtml(item.transport||'')}" /></td><td class="schedule-col-action"><button class="schedule-remove" type="button" data-remove-schedule="${item.id}" aria-label="${escapeHtml(place.name)} 일정에서 제거">×</button></td></tr>`:''}).join(''):`<tr class="table-empty"><td colspan="8">왼쪽 장소를 이 표로 드래그하세요.</td></tr>`}</tbody></table></div></section>`;}).join(''):'<div class="empty-small">위에서 여행 기간을 선택하면 날짜별 표가 생겨요.</div>';}
const baseRenderDetailContent=renderDetailContent;
renderDetailContent=function(){baseRenderDetailContent();renderScheduleTables();};
document.addEventListener('change',event=>{const field=event.target.closest('[data-schedule-field]');if(!field)return;const item=state.schedule.find(schedule=>schedule.id===field.dataset.scheduleId);if(item){item[field.dataset.scheduleField]=field.value;save();}});
function renderCompactScheduleTables(){const places=tripPlaces(),dates=tripDates(),schedule=tripSchedule(),sections=$('#dateSections');if(!sections)return;sections.innerHTML=dates.length?dates.map(date=>{const rows=schedule.filter(item=>item.dateId===date.id).sort((a,b)=>(a.order||0)-(b.order||0));return`<section class="date-section" data-date-section="${date.id}"><div class="date-section-head"><div><h3>${escapeHtml(date.value)}</h3><span>${rows.length}개 장소</span></div><button class="mini-delete" type="button" data-delete-date="${date.id}" aria-label="${escapeHtml(date.value)} 날짜 삭제">×</button></div><div class="date-dropzone schedule-dropzone" data-date-dropzone="${date.id}"><table class="schedule-table compact-schedule-table"><thead><tr><th class="schedule-col-order">순번</th><th class="schedule-col-time">시간</th><th class="schedule-col-place">장소명</th><th class="schedule-col-cost">소요금액</th><th class="schedule-col-action" aria-label="상세"></th></tr></thead><tbody>${rows.length?rows.map((item,index)=>{const place=places.find(saved=>saved.id===item.placeId);return place?`<tr class="schedule-table-row" draggable="true" data-schedule-id="${item.id}"><td class="schedule-col-order"><span class="schedule-order">${String(index+1).padStart(2,'0')}</span></td><td class="schedule-col-time"><input class="schedule-cell-input" data-schedule-id="${item.id}" data-schedule-field="time" type="text" inputmode="numeric" placeholder="09:00" value="${escapeHtml(item.time||'')}" /></td><td class="schedule-col-place"><strong>${escapeHtml(place.name)}</strong><small>${escapeHtml(place.category)}</small></td><td class="schedule-col-cost"><input class="schedule-cell-input cost-input" data-schedule-id="${item.id}" data-schedule-field="cost" type="number" inputmode="numeric" min="0" placeholder="0" value="${escapeHtml(item.cost??'')}" /></td><td class="schedule-col-action"><button class="schedule-detail-button" type="button" data-schedule-details="${item.id}" aria-label="${escapeHtml(place.name)} 상세 입력">⌕</button></td></tr>`:''}).join(''):`<tr class="table-empty"><td colspan="5">왼쪽 장소를 이 표로 드래그하세요.</td></tr>`}</tbody></table></div></section>`;}).join(''):'<div class="empty-small">위에서 여행 기간을 선택하면 날짜별 표가 생겨요.</div>';}
renderScheduleTables=renderCompactScheduleTables;
function openScheduleDetails(scheduleId){const item=state.schedule.find(schedule=>schedule.id===scheduleId),place=tripPlaces().find(saved=>saved.id===item?.placeId);if(!item||!place)return;let modal=$('#scheduleDetailModal');if(!modal){document.body.insertAdjacentHTML('beforeend','<dialog class="trip-modal schedule-detail-modal" id="scheduleDetailModal"><form class="modal-box" id="scheduleDetailForm"><button class="modal-close" type="button" data-close-schedule-detail>×</button><p class="eyebrow">SCHEDULE DETAIL</p><h2 id="scheduleDetailTitle"></h2><p>장소의 추가 정보를 입력해두면 일정표에서 바로 확인할 수 있어요.</p><div class="schedule-detail-fields"><label>주소<input class="modal-input" name="address" type="text" placeholder="주소 입력" /></label><label>체류시간<input class="modal-input" name="stay" type="text" placeholder="예: 90분" /></label><label>교통<input class="modal-input" name="transport" type="text" placeholder="예: 도보 10분" /></label></div><div class="modal-actions"><button class="outline-button" type="button" data-close-schedule-detail>취소</button><button class="gradient-button" type="submit">저장</button></div></form></dialog>');modal=$('#scheduleDetailModal');}$('#scheduleDetailTitle').textContent=place.name;const form=$('#scheduleDetailForm');form.dataset.scheduleId=scheduleId;form.elements.address.value=item.address||'';form.elements.stay.value=item.stay||'';form.elements.transport.value=item.transport||'';modal.showModal();form.elements.address.focus();}
document.addEventListener('click',event=>{const detailButton=event.target.closest('[data-schedule-details]');if(detailButton){openScheduleDetails(detailButton.dataset.scheduleDetails);return;}const closeButton=event.target.closest('[data-close-schedule-detail]');if(closeButton){$('#scheduleDetailModal')?.close();}});
document.addEventListener('submit',event=>{if(event.target.id!=='scheduleDetailForm')return;event.preventDefault();const form=event.target,item=state.schedule.find(schedule=>schedule.id===form.dataset.scheduleId);if(!item)return;const values=new FormData(form);item.address=String(values.get('address')||'').trim();item.stay=String(values.get('stay')||'').trim();item.transport=String(values.get('transport')||'').trim();save();$('#scheduleDetailModal')?.close();renderDetailContent();toast('일정 상세 정보를 저장했어요.');});
const renderDetailWithCalendar=renderDetail;
renderDetail=function(){renderDetailWithCalendar();const title=document.querySelector('.places-card .detail-card-head h2');if(title)title.textContent='나의 위시 장소';};
function addDatePlaceButtons(){document.querySelectorAll('[data-date-section]').forEach(section=>{const head=section.querySelector('.date-section-head'),dateId=section.dataset.dateSection;if(!head||head.querySelector('[data-add-date-place]'))return;head.insertAdjacentHTML('beforeend',`<button class="date-add-place" type="button" data-add-date-place="${dateId}">＋ 장소 추가</button>`);});}
const baseRenderDetailContentWithCompact=renderDetailContent;
renderDetailContent=function(){baseRenderDetailContentWithCompact();addDatePlaceButtons();};
function openDatePlacePicker(dateId){let modal=$('#datePlaceModal');if(!modal){document.body.insertAdjacentHTML('beforeend','<dialog class="trip-modal date-place-modal" id="datePlaceModal"><form class="modal-box" id="datePlaceForm"><button class="modal-close" type="button" data-close-date-place>×</button><p class="eyebrow">ADD TO SCHEDULE</p><h2>날짜에 장소 추가</h2><p>나의 위시 장소에서 이 날짜의 표에 넣을 장소를 선택하세요.</p><div class="date-place-options" id="datePlaceOptions"></div><div class="modal-actions"><button class="outline-button" type="button" data-close-date-place>닫기</button></div></form></dialog>');modal=$('#datePlaceModal');}const used=new Set(tripSchedule().filter(item=>item.dateId===dateId).map(item=>item.placeId)),available=tripPlaces().filter(place=>!used.has(place.id)),options=$('#datePlaceOptions');options.innerHTML=available.length?available.map(place=>`<button class="date-place-option" type="button" data-add-place-to-date="${dateId}" data-place-id="${place.id}"><span><strong>${escapeHtml(place.name)}</strong><small>${escapeHtml(place.category)}</small></span><b>＋</b></button>`).join(''):'<div class="empty-small">추가할 수 있는 위시 장소가 없어요.</div>';modal.showModal();}
document.addEventListener('click',event=>{const addDate=event.target.closest('[data-add-date-place]');if(addDate){openDatePlacePicker(addDate.dataset.addDatePlace);return;}const addPlace=event.target.closest('[data-add-place-to-date]');if(addPlace){const dateId=addPlace.dataset.addPlaceToDate,placeId=addPlace.dataset.placeId;if(!state.schedule.some(item=>item.dateId===dateId&&item.placeId===placeId)){state.schedule.push({id:uid(),tripId:state.activeTripId,dateId,placeId,order:state.schedule.filter(item=>item.dateId===dateId).length});save();$('#datePlaceModal')?.close();renderDetailContent();toast('장소를 날짜 표에 추가했어요.');}}const close=event.target.closest('[data-close-date-place]');if(close)$('#datePlaceModal')?.close();});
function renderDirectScheduleTables(){const places=tripPlaces(),dates=tripDates(),schedule=tripSchedule(),sections=$('#dateSections');if(!sections)return;sections.innerHTML=dates.length?dates.map(date=>{const rows=schedule.filter(item=>item.dateId===date.id).sort((a,b)=>(a.order||0)-(b.order||0));return`<section class="date-section" data-date-section="${date.id}"><div class="date-section-head"><div><h3>${escapeHtml(date.value)}</h3><span>${rows.length}개 장소</span></div><button class="mini-delete" type="button" data-delete-date="${date.id}" aria-label="${escapeHtml(date.value)} 날짜 삭제">×</button></div><div class="date-dropzone schedule-dropzone" data-date-dropzone="${date.id}"><table class="schedule-table compact-schedule-table"><thead><tr><th class="schedule-col-order">순번</th><th class="schedule-col-time">시간</th><th class="schedule-col-place">장소명</th><th class="schedule-col-cost">소요금액</th><th class="schedule-col-action" aria-label="상세"></th></tr></thead><tbody>${rows.length?rows.map((item,index)=>{const place=places.find(saved=>saved.id===item.placeId),name=item.placeName||place?.name||'';return`<tr class="schedule-table-row" draggable="true" data-schedule-id="${item.id}"><td class="schedule-col-order"><span class="schedule-order">${String(index+1).padStart(2,'0')}</span></td><td class="schedule-col-time"><input class="schedule-cell-input" data-schedule-id="${item.id}" data-schedule-field="time" type="text" inputmode="numeric" placeholder="09:00" value="${escapeHtml(item.time||'')}" /></td><td class="schedule-col-place"><input class="schedule-cell-input place-name-input" data-schedule-id="${item.id}" data-schedule-field="placeName" type="text" placeholder="장소명 입력" value="${escapeHtml(name)}" /><small>${escapeHtml(place?.category||'')}</small></td><td class="schedule-col-cost"><input class="schedule-cell-input cost-input" data-schedule-id="${item.id}" data-schedule-field="cost" type="number" inputmode="numeric" min="0" placeholder="0" value="${escapeHtml(item.cost??'')}" /></td><td class="schedule-col-action"><button class="schedule-detail-button" type="button" data-schedule-details="${item.id}" aria-label="${escapeHtml(name||'장소')} 상세 입력">⌕</button></td></tr>`}).join(''):`<tr class="table-empty"><td colspan="5">＋ 장소 추가 버튼으로 빈 행을 만들거나 왼쪽 장소를 드래그하세요.</td></tr>`}</tbody></table></div></section>`;}).join(''):'<div class="empty-small">위에서 여행 기간을 선택하면 날짜별 표가 생겨요.</div>';}
renderScheduleTables=renderDirectScheduleTables;
openDatePlacePicker=function(dateId){const id=uid();state.schedule.push({id,tripId:state.activeTripId,dateId,placeId:'',placeName:'',order:tripSchedule().filter(item=>item.dateId===dateId).length});save();renderDetailContent();setTimeout(()=>document.querySelector(`[data-schedule-id="${id}"] [data-schedule-field="placeName"]`)?.focus(),0);toast('날짜 표에 빈 장소 행을 추가했어요.');};
openScheduleDetails=function(scheduleId){const item=state.schedule.find(schedule=>schedule.id===scheduleId),place=tripPlaces().find(saved=>saved.id===item?.placeId),name=item?.placeName||place?.name;if(!item||!name)return;let modal=$('#scheduleDetailModal');if(!modal){document.body.insertAdjacentHTML('beforeend','<dialog class="trip-modal schedule-detail-modal" id="scheduleDetailModal"><form class="modal-box" id="scheduleDetailForm"><button class="modal-close" type="button" data-close-schedule-detail>×</button><p class="eyebrow">SCHEDULE DETAIL</p><h2 id="scheduleDetailTitle"></h2><p>장소의 추가 정보를 입력해두면 일정표에서 바로 확인할 수 있어요.</p><div class="schedule-detail-fields"><label>주소<input class="modal-input" name="address" type="text" placeholder="주소 입력" /></label><label>체류시간<input class="modal-input" name="stay" type="text" placeholder="예: 90분" /></label><label>교통<input class="modal-input" name="transport" type="text" placeholder="예: 도보 10분" /></label></div><div class="modal-actions"><button class="outline-button" type="button" data-close-schedule-detail>닫기</button><button class="gradient-button" type="submit">저장</button></div></form></dialog>');modal=$('#scheduleDetailModal');}$('#scheduleDetailTitle').textContent=name;const form=$('#scheduleDetailForm');form.dataset.scheduleId=scheduleId;form.elements.address.value=item.address||'';form.elements.stay.value=item.stay||'';form.elements.transport.value=item.transport||'';modal.showModal();form.elements.address.focus();};
let calendarPreviousStart='',calendarPreviousEnd='',calendarReadyForComparison=false;
const baseEnsureTripDateSections=ensureTripDateSections;
ensureTripDateSections=function(trip){const start=parseDateValue(trip?.startDate),end=parseDateValue(trip?.endDate),changed=calendarPreviousStart!==start||calendarPreviousEnd!==end,hasExisting=state.dates.some(date=>date.tripId===trip?.id);if(calendarReadyForComparison&&changed&&hasExisting){state.dates=state.dates.filter(date=>date.tripId!==trip.id);state.schedule=state.schedule.filter(item=>item.tripId!==trip.id);}baseEnsureTripDateSections(trip);calendarPreviousStart=start;calendarPreviousEnd=end;};
const baseSetupCalendarPicker=setupCalendarPicker;
setupCalendarPicker=function(){const trip=currentTrip();calendarPreviousStart=parseDateValue(trip?.startDate);calendarPreviousEnd=parseDateValue(trip?.endDate);calendarReadyForComparison=true;baseSetupCalendarPicker();};
const baseNormalize=normalize;
normalize=function(input){const result=baseNormalize(input),rawPlans=Array.isArray(input?.schedule)?input.schedule:(Array.isArray(input?.plans)?input.plans:[]),fields=['placeName','time','address','cost','stay','transport'],rawById=new Map(rawPlans.filter(item=>item?.id).map(item=>[String(item.id),item]));result.schedule=result.schedule.map(item=>{const raw=rawById.get(String(item.id));if(!raw)return item;return fields.reduce((next,field)=>{if(raw[field]!==undefined)next[field]=raw[field];return next;},{...item});});const known=new Set(result.schedule.map(item=>String(item.id)));rawPlans.filter(item=>item&&!known.has(String(item.id))&&((item.placeName!==undefined)||(!item.placeId&&item.dateId))).forEach(item=>{const tripId=String(item.tripId||item.destinationId||result.trips[0]?.id||'');if(!tripId)return;result.schedule.push({id:String(item.id||uid()),tripId,dateId:String(item.dateId||''),placeId:String(item.placeId||''),placeName:String(item.placeName||''),order:Number.isFinite(item.order)?item.order:0,time:String(item.time||''),address:String(item.address||''),cost:item.cost??'',stay:String(item.stay||''),transport:String(item.transport||'')});});return result;};
document.addEventListener('input',event=>{const field=event.target.closest('[data-schedule-field]');if(!field)return;const item=state.schedule.find(schedule=>schedule.id===field.dataset.scheduleId);if(item){item[field.dataset.scheduleField]=field.value;save();}});
function wonInputValue(value){const digits=String(value??'').replace(/\D/g,'');return digits?Number(digits).toLocaleString('ko-KR'):'';}
function formatScheduleCosts(){document.querySelectorAll('[data-schedule-field="cost"]').forEach(field=>{const item=state.schedule.find(schedule=>schedule.id===field.dataset.scheduleId);field.type='text';field.inputMode='numeric';field.value=wonInputValue(item?.cost);});}
const baseRenderDetailContentWithCostFormat=renderDetailContent;
renderDetailContent=function(){baseRenderDetailContentWithCostFormat();formatScheduleCosts();};
document.addEventListener('input',event=>{const field=event.target.closest('[data-schedule-field="cost"]');if(!field)return;const digits=field.value.replace(/\D/g,'');const item=state.schedule.find(schedule=>schedule.id===field.dataset.scheduleId);if(item)item.cost=digits?Number(digits):'';field.value=digits?Number(digits).toLocaleString('ko-KR'):'';save();});
document.addEventListener('change',event=>{const field=event.target.closest('[data-schedule-field="cost"]');if(!field)return;const digits=field.value.replace(/\D/g,'');const item=state.schedule.find(schedule=>schedule.id===field.dataset.scheduleId);if(item)item.cost=digits?Number(digits):'';field.value=digits?Number(digits).toLocaleString('ko-KR'):'';save();});
const renderTripListWithDelete=renderTripList;
renderTripList=function(){renderTripListWithDelete();document.querySelectorAll('.trip-card').forEach(card=>{const top=card.querySelector('.trip-card-top');if(top&&!top.querySelector('[data-delete-trip]'))top.insertAdjacentHTML('beforeend',`<button class="trip-card-delete" type="button" data-delete-trip="${card.dataset.tripId}" aria-label="${escapeHtml(card.querySelector('h2')?.textContent||'여행')} 삭제">×</button>`);});};
document.addEventListener('click',event=>{const button=event.target.closest('[data-delete-trip]');if(!button)return;event.preventDefault();event.stopImmediatePropagation();const tripId=button.dataset.deleteTrip,trip=state.trips.find(item=>item.id===tripId);if(!trip||!window.confirm(`'${trip.name}' 여행을 삭제할까요?\n장소, 일정, 경비도 함께 삭제됩니다.`))return;state.trips=state.trips.filter(item=>item.id!==tripId);state.places=state.places.filter(item=>item.tripId!==tripId);state.dates=state.dates.filter(item=>item.tripId!==tripId);state.schedule=state.schedule.filter(item=>item.tripId!==tripId);state.expenses=state.expenses.filter(item=>item.tripId!==tripId);state.tripPackingLists=state.tripPackingLists.filter(item=>item.tripId!==tripId);state.tripPackings=state.tripPackings.filter(item=>item.tripId!==tripId);state.tripCustomPackings=state.tripCustomPackings.filter(item=>item.tripId!==tripId);state.activeTripId=state.trips[0]?.id||'';save();renderTripList();toast('여행을 삭제했어요.');});
const renderTripListWithMenu=renderTripList;
renderTripList=function(){renderTripListWithMenu();document.querySelectorAll('.trip-card').forEach(card=>{const top=card.querySelector('.trip-card-top'),edit=top?.querySelector('[data-edit-trip]'),deleteButton=top?.querySelector('[data-delete-trip]');if(!top||top.querySelector('.trip-card-menu'))return;const tripId=card.dataset.tripId;edit?.remove();deleteButton?.remove();top.insertAdjacentHTML('beforeend',`<div class="trip-card-menu"><button class="trip-card-menu-trigger" type="button" aria-label="여행 메뉴" aria-expanded="false">⋮</button><div class="trip-card-menu-panel"><button type="button" data-edit-trip="${tripId}">수정</button><button type="button" data-delete-trip="${tripId}">삭제</button></div></div>`);});};
document.addEventListener('click',event=>{const trigger=event.target.closest('.trip-card-menu-trigger');if(trigger){event.preventDefault();event.stopPropagation();const menu=trigger.closest('.trip-card-menu'),isOpen=menu.classList.toggle('open');trigger.setAttribute('aria-expanded',String(isOpen));document.querySelectorAll('.trip-card-menu.open').forEach(other=>{if(other!==menu){other.classList.remove('open');other.querySelector('.trip-card-menu-trigger')?.setAttribute('aria-expanded','false');}});return;}if(!event.target.closest('.trip-card-menu'))document.querySelectorAll('.trip-card-menu.open').forEach(menu=>{menu.classList.remove('open');menu.querySelector('.trip-card-menu-trigger')?.setAttribute('aria-expanded','false');});});
function toggleTripMenu(trigger){const menu=trigger.closest('.trip-card-menu'),isOpen=menu.classList.toggle('open');trigger.setAttribute('aria-expanded',String(isOpen));document.querySelectorAll('.trip-card-menu.open').forEach(other=>{if(other!==menu){other.classList.remove('open');other.querySelector('.trip-card-menu-trigger')?.setAttribute('aria-expanded','false');}});}
const renderTripListWithTriggerFix=renderTripList;
renderTripList=function(){renderTripListWithTriggerFix();document.querySelectorAll('.trip-card-menu-trigger').forEach(trigger=>{trigger.addEventListener('click',event=>{event.preventDefault();event.stopImmediatePropagation();toggleTripMenu(trigger);});});};
const TRIP_DB_VERSION=3;
dbPromise=null;
openDb=function(){if(dbPromise)return dbPromise;dbPromise=new Promise((resolve,reject)=>{const request=indexedDB.open(TRIP_DB,TRIP_DB_VERSION);request.onupgradeneeded=()=>{const db=request.result;if(!db.objectStoreNames.contains(TRIP_STORE))db.createObjectStore(TRIP_STORE);};request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});return dbPromise;};
start=function(){if(!document.querySelector('link[href*="trip.css"]')){const link=document.createElement('link');link.rel='stylesheet';link.href='trip.css?v=20260804-3';document.head.append(link);}bindGlobalEvents();openDb().then(db=>{const read=db.transaction(TRIP_STORE,'readonly').objectStore(TRIP_STORE).get(TRIP_KEY);read.onsuccess=()=>{if(read.result)state=normalize(read.result);renderTripList();};read.onerror=()=>renderTripList();}).catch(()=>renderTripList());};
const browserPersistState=persistState;
const isNativeAndroid=()=>typeof window!=='undefined'&&window.TripDb&&typeof window.TripDb.loadState==='function';
async function commitState(){if(isNativeAndroid()){try{if(!window.TripDb.saveState(JSON.stringify(state)))throw new Error('Native save failed');hasUnsavedChanges=false;updateSaveStatus('저장됨');}catch(error){updateSaveStatus('저장 실패');}return;}return browserPersistState();}
save=async function(){markUnsaved();};
const browserStart=start;
start=function(){if(!isNativeAndroid())return browserStart();if(!document.querySelector('link[href*="trip.css"]')){const link=document.createElement('link');link.rel='stylesheet';link.href='trip.css?v=20260804-3';document.head.append(link);}bindGlobalEvents();try{const raw=window.TripDb.loadState();if(raw)state=normalize(JSON.parse(raw));renderTripList();}catch(error){renderTripList();}finally{document.documentElement.classList.remove('page-loading');}};
if('serviceWorker' in navigator&&location.protocol!=='file:')navigator.serviceWorker.register('./service-worker.js',{updateViaCache:'none'}).catch(()=>{});
function scheduleAmount(item){const digits=String(item?.cost??'').replace(/\D/g,'');return digits?Number(digits):0;}
function updateTripTotal(){const totalNode=$('#tripScheduleTotal');if(totalNode)totalNode.textContent=money(tripSchedule().reduce((sum,item)=>sum+scheduleAmount(item),0));}
function mountTripSummary(){const titleWrap=document.querySelector('.detail-title-wrap');if(!titleWrap||titleWrap.querySelector('.trip-summary'))return;titleWrap.insertAdjacentHTML('beforeend','<div class="trip-summary"><div><span>여행 총 지출</span><strong id="tripScheduleTotal">₩0</strong></div><button class="stats-button" type="button" data-open-spend-stats>소비 통계</button></div>');}
function hideLegacyExpenses(){const card=document.querySelector('.left-stack #expenseForm')?.closest('.detail-card');if(card)card.classList.add('legacy-expenses-hidden');}
const baseRenderDetailForSummary=renderDetail;
renderDetail=function(){baseRenderDetailForSummary();hideLegacyExpenses();mountTripSummary();updateTripTotal();};
const baseRenderContentForSummary=renderDetailContent;
renderDetailContent=function(){baseRenderContentForSummary();updateTripTotal();};
function openSpendStats(){const total=tripSchedule().reduce((sum,item)=>sum+scheduleAmount(item),0),groups={};tripSchedule().forEach(item=>{const place=tripPlaces().find(saved=>saved.id===item.placeId),category=place?.category||'기타';groups[category]=(groups[category]||0)+scheduleAmount(item);});const rows=Object.entries(groups).filter(([,amount])=>amount>0).sort((a,b)=>b[1]-a[1]),max=rows[0]?.[1]||1;let modal=$('#spendStatsModal');if(!modal){document.body.insertAdjacentHTML('beforeend','<dialog class="trip-modal spend-stats-modal" id="spendStatsModal"><form class="modal-box"><button class="modal-close" type="button" data-close-spend-stats>×</button><p class="eyebrow">SPENDING INSIGHTS</p><h2>소비 통계</h2><p>일정표에 입력한 소요금액을 카테고리별로 모아봤어요.</p><div id="spendStatsContent"></div><div class="modal-actions"><button class="gradient-button" type="button" data-close-spend-stats>확인</button></div></form></dialog>');modal=$('#spendStatsModal');}const content=$('#spendStatsContent');content.innerHTML=rows.length?`<div class="stats-total"><span>총 지출</span><strong>${money(total)}</strong></div><div class="stats-bars">${rows.map(([category,amount])=>`<div class="stats-bar-row"><div><span>${escapeHtml(category)}</span><strong>${money(amount)}</strong></div><div class="stats-bar"><i style="width:${Math.max(8,Math.round(amount/max*100))}%"></i></div></div>`).join('')}</div>`:'<div class="empty-small">입력된 소요금액이 아직 없어요.</div>';modal.showModal();}
document.addEventListener('click',event=>{if(event.target.closest('[data-open-spend-stats]')){event.preventDefault();event.stopPropagation();openSpendStats();return;}if(event.target.closest('[data-close-spend-stats]'))$('#spendStatsModal')?.close();});
document.addEventListener('input',event=>{if(event.target.closest('[data-schedule-field="cost"]'))updateTripTotal();});
const renderTripListWithScheduleTotal=renderTripList;
renderTripList=function(){renderTripListWithScheduleTotal();document.querySelectorAll('.trip-card').forEach(card=>{const total=state.schedule.filter(item=>item.tripId===card.dataset.tripId).reduce((sum,item)=>sum+scheduleAmount(item),0),totalNode=card.querySelector('.trip-card-meta span:last-child');if(totalNode)totalNode.textContent=money(total);});};
function renderCategorizedScheduleTables(){const places=tripPlaces(),dates=tripDates(),schedule=tripSchedule(),categories=state.categories.places,sections=$('#dateSections');if(!sections)return;sections.innerHTML=dates.length?dates.map(date=>{const rows=schedule.filter(item=>item.dateId===date.id).sort((a,b)=>(a.order||0)-(b.order||0));return`<section class="date-section" data-date-section="${date.id}"><div class="date-section-head"><div><h3>${escapeHtml(date.value)}</h3><span>${rows.length}개 장소</span></div><button class="mini-delete" type="button" data-delete-date="${date.id}" aria-label="${escapeHtml(date.value)} 날짜 삭제">×</button></div><div class="date-dropzone schedule-dropzone" data-date-dropzone="${date.id}"><table class="schedule-table compact-schedule-table"><thead><tr><th class="schedule-col-order">순번</th><th class="schedule-col-time">시간</th><th class="schedule-col-category">카테고리</th><th class="schedule-col-place">장소명</th><th class="schedule-col-cost">소요금액</th><th class="schedule-col-action" aria-label="상세"></th></tr></thead><tbody>${rows.length?rows.map((item,index)=>{const place=places.find(saved=>saved.id===item.placeId),name=item.placeName||place?.name||'',category=item.category||place?.category||categories[0]||'기타';return`<tr class="schedule-table-row" draggable="true" data-schedule-id="${item.id}"><td class="schedule-col-order"><span class="schedule-order">${String(index+1).padStart(2,'0')}</span></td><td class="schedule-col-time"><input class="schedule-cell-input" data-schedule-id="${item.id}" data-schedule-field="time" type="text" inputmode="numeric" placeholder="09:00" value="${escapeHtml(item.time||'')}" /></td><td class="schedule-col-category"><select class="schedule-cell-input schedule-category-input" data-schedule-id="${item.id}" data-schedule-field="category">${categories.map(option=>`<option value="${escapeHtml(option)}"${option===category?' selected':''}>${escapeHtml(option)}</option>`).join('')}</select></td><td class="schedule-col-place"><input class="schedule-cell-input place-name-input" data-schedule-id="${item.id}" data-schedule-field="placeName" type="text" placeholder="장소명 입력" value="${escapeHtml(name)}" /></td><td class="schedule-col-cost"><input class="schedule-cell-input cost-input" data-schedule-id="${item.id}" data-schedule-field="cost" type="text" inputmode="numeric" placeholder="0" value="${escapeHtml(item.cost??'')}" /></td><td class="schedule-col-action"><button class="schedule-detail-button" type="button" data-schedule-details="${item.id}" aria-label="${escapeHtml(name||'장소')} 상세 입력">⌕</button></td></tr>`}).join(''):`<tr class="table-empty"><td colspan="6">＋ 장소 추가 버튼으로 빈 행을 만들거나 왼쪽 장소를 드래그하세요.</td></tr>`}</tbody></table></div></section>`;}).join(''):'<div class="empty-small">위에서 여행 기간을 선택하면 날짜별 표가 생겨요.</div>';}
renderScheduleTables=renderCategorizedScheduleTables;
const baseNormalizeWithCategory=normalize;
normalize=function(input){const result=baseNormalizeWithCategory(input),rawPlans=Array.isArray(input?.schedule)?input.schedule:(Array.isArray(input?.plans)?input.plans:[]),rawById=new Map(rawPlans.filter(item=>item?.id).map(item=>[String(item.id),item]));result.schedule=result.schedule.map(item=>{const raw=rawById.get(String(item.id));return raw?.category!==undefined?{...item,category:String(raw.category||'')} : item;});return result;};
openDatePlacePicker=function(dateId){const id=uid();state.schedule.push({id,tripId:state.activeTripId,dateId,placeId:'',placeName:'',category:state.categories.places[0]||'기타',order:tripSchedule().filter(item=>item.dateId===dateId).length});save();renderDetailContent();setTimeout(()=>document.querySelector(`[data-schedule-id="${id}"] [data-schedule-field="placeName"]`)?.focus(),0);toast('날짜 표에 빈 장소 행을 추가했어요.');};
const normalizeWithScheduleRecovery=normalize;
normalize=function(input){const result=normalizeWithScheduleRecovery(input),rawPlans=Array.isArray(input?.schedule)?input.schedule:(Array.isArray(input?.plans)?input.plans:[]),known=new Set(result.schedule.map(item=>String(item.id)));rawPlans.filter(item=>item?.id&&!known.has(String(item.id))&&item.dateId&&(item.placeId||item.placeName!==undefined)).forEach(item=>{result.schedule.push({id:String(item.id),tripId:String(item.tripId||item.destinationId||result.trips[0]?.id||''),dateId:String(item.dateId),placeId:String(item.placeId||''),placeName:String(item.placeName||''),category:String(item.category||''),order:Number.isFinite(item.order)?item.order:0,time:String(item.time||''),address:String(item.address||''),cost:item.cost??'',stay:String(item.stay||''),transport:String(item.transport||'')});});return result;};
openSpendStats=function(){const total=tripSchedule().reduce((sum,item)=>sum+scheduleAmount(item),0),groups={};tripSchedule().forEach(item=>{const place=tripPlaces().find(saved=>saved.id===item.placeId),category=item.category||place?.category||'기타';groups[category]=(groups[category]||0)+scheduleAmount(item);});const rows=Object.entries(groups).filter(([,amount])=>amount>0).sort((a,b)=>b[1]-a[1]),max=rows[0]?.[1]||1;let modal=$('#spendStatsModal');if(!modal){document.body.insertAdjacentHTML('beforeend','<dialog class="trip-modal spend-stats-modal" id="spendStatsModal"><form class="modal-box"><button class="modal-close" type="button" data-close-spend-stats>×</button><p class="eyebrow">SPENDING INSIGHTS</p><h2>소비 통계</h2><p>일정표에 입력한 소요금액을 카테고리별로 모아봤어요.</p><div id="spendStatsContent"></div><div class="modal-actions"><button class="gradient-button" type="button" data-close-spend-stats>확인</button></div></form></dialog>');modal=$('#spendStatsModal');}const content=$('#spendStatsContent');content.innerHTML=rows.length?`<div class="stats-total"><span>총 지출</span><strong>${money(total)}</strong></div><div class="stats-bars">${rows.map(([category,amount])=>`<div class="stats-bar-row"><div><span>${escapeHtml(category)}</span><strong>${money(amount)}</strong></div><div class="stats-bar"><i style="width:${Math.max(8,Math.round(amount/max*100))}%"></i></div></div>`).join('')}</div>`:'<div class="empty-small">입력된 소요금액이 아직 없어요.</div>';modal.showModal();};
function sideNavMarkup(active){return`<aside class="side-nav"><div class="side-nav-brand"><span class="brand-orb"></span><span>TRIP//LOG</span></div><nav class="side-nav-links" aria-label="주요 메뉴"><button type="button" class="side-nav-link${active==='trips'?' active':''}" data-app-nav="trips"><span>01</span><strong>내 여행</strong></button><button type="button" class="side-nav-link${active==='packing'?' active':''}" data-app-nav="packing"><span>02</span><strong>준비물</strong></button></nav></aside>`;}
function mountSideNav(active){const app=document.querySelector('.trip-app'),main=app?.querySelector('main');if(!app||!main)return;let layout=app.querySelector('.app-layout'),content=app.querySelector('.app-content');if(!layout){layout=document.createElement('div');layout.className='app-layout';content=document.createElement('div');content.className='app-content';main.replaceWith(layout);layout.append(content);content.append(main);}layout.querySelector('.side-nav')?.remove();layout.insertAdjacentHTML('afterbegin',sideNavMarkup(active));}
function renderPacking(){document.body.innerHTML=`<div class="trip-app">${header()}<main class="trip-list-page packing-page"><section class="list-intro packing-intro"><div><p class="eyebrow">TRAVEL CHECKLIST</p><h1>준비물</h1><p>여행에 챙길 물건을 정리하는 공간이에요.</p></div></section><section class="packing-empty"><span>✦</span><strong>준비물 목록을 준비 중이에요.</strong><p>필요한 준비물 항목과 기능을 알려주시면 이곳에 맞춰 채워드릴게요.</p></section></main></div>`;mountSideNav('packing');}
const renderTripListWithSideNav=renderTripList;
renderTripList=function(){renderTripListWithSideNav();mountSideNav('trips');};
function mountInlineTripTitleEditor(){const titleWrap=document.querySelector('.detail-title-wrap'),title=titleWrap?.querySelector('h1'),oldButton=titleWrap?.querySelector('[data-edit-current-trip]');if(!title||!oldButton||titleWrap.querySelector('[data-inline-trip-edit],[data-inline-trip-save]'))return;const button=document.createElement('button');button.className='trip-title-icon-button';button.type='button';button.dataset.inlineTripEdit='true';button.setAttribute('aria-label','여행지명 수정');button.title='여행지명 수정';button.textContent='✎';const row=document.createElement('div');row.className='trip-title-heading';title.replaceWith(row);row.append(title,button);oldButton.remove();}
function beginInlineTripTitleEdit(button){const title=button.closest('.trip-title-heading')?.querySelector('h1');if(!title)return;const input=document.createElement('input');input.className='trip-title-input';input.type='text';input.maxLength=40;input.value=title.textContent.trim();input.setAttribute('aria-label','여행지명');title.replaceWith(input);delete button.dataset.inlineTripEdit;button.dataset.inlineTripSave='true';button.setAttribute('aria-label','여행지명 수정 완료');button.title='수정 완료';button.textContent='✓';input.focus();input.select();input.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();saveInlineTripTitle(button,input);}if(event.key==='Escape'){event.preventDefault();renderDetail();}});}
function saveInlineTripTitle(button,input){const name=input.value.trim();if(!name){input.focus();return;}const trip=currentTrip();if(trip)trip.name=name;save();renderDetail();toast('여행지명을 수정했어요.');}
const renderDetailWithSideNav=renderDetail;
renderDetail=function(){renderDetailWithSideNav();mountSideNav('trips');mountInlineTripTitleEditor();};
document.addEventListener('click',event=>{const nav=event.target.closest('[data-app-nav]');if(!nav)return;event.preventDefault();if(nav.dataset.appNav==='packing')renderPacking();else{document.body.dataset.page='list';renderTripList();}});
document.addEventListener('click',event=>{const edit=event.target.closest('[data-inline-trip-edit]');if(edit){beginInlineTripTitleEdit(edit);return;}const saveButton=event.target.closest('[data-inline-trip-save]');if(saveButton){const input=saveButton.closest('.trip-title-heading')?.querySelector('.trip-title-input');if(input)saveInlineTripTitle(saveButton,input);}});
function formatFourDigitTime(value){const digits=String(value??'').replace(/\D/g,'').slice(0,4);return digits.length===4?`${digits.slice(0,2)}:${digits.slice(2)}`:digits;}
document.addEventListener('input',event=>{const field=event.target.closest('[data-schedule-field="time"]');if(!field)return;const formatted=formatFourDigitTime(field.value);if(field.value!==formatted)field.value=formatted;const item=state.schedule.find(schedule=>schedule.id===field.dataset.scheduleId);if(item){item.time=formatted;save();}});
const renderDetailContentWithGroupedPlaces=renderDetailContent;
function renderGroupedPlaceList(){const list=$('#placeList');if(!list)return;const groups=tripPlaces().reduce((map,place)=>{const category=place.category||'기타';(map[category]??=[]).push(place);return map;},{});list.innerHTML=Object.entries(groups).map(([category,items])=>`<section class="saved-place-group"><div class="saved-place-group-head"><strong>${escapeHtml(category)}</strong><span>${items.length}개</span></div><div class="saved-place-group-items">${items.map(place=>`<div class="saved-place" draggable="true" data-place-id="${place.id}"><span class="saved-place-category">${escapeHtml(category)}</span><span class="place-dot"></span><span class="saved-place-name" title="${escapeHtml(place.name)}">${escapeHtml(place.name)}</span><button class="mini-delete" type="button" data-delete-place="${place.id}" aria-label="${escapeHtml(place.name)} 삭제">×</button></div>`).join('')}</div></section>`).join('')||'<div class="empty-small">저장한 장소가 없어요.</div>';}
renderDetailContent=function(){renderDetailContentWithGroupedPlaces();renderGroupedPlaceList();};
let collapsedPlaceCategories=new Set();
function renderGroupedPlaceListWithAccordion(){const list=$('#placeList');if(!list)return;const groups=tripPlaces().reduce((map,place)=>{const category=place.category||'기타';(map[category]??=[]).push(place);return map;},{});list.innerHTML=Object.entries(groups).map(([category,items])=>{const collapsed=collapsedPlaceCategories.has(category);return`<section class="saved-place-group"><button class="saved-place-group-toggle" type="button" data-place-category-toggle="${escapeHtml(category)}" aria-expanded="${String(!collapsed)}"><span><strong>${escapeHtml(category)}</strong><small>${items.length}개</small></span><i aria-hidden="true">⌄</i></button><div class="saved-place-group-items"${collapsed?' hidden':''}>${items.map(place=>`<div class="saved-place" draggable="true" data-place-id="${place.id}"><span class="saved-place-category">${escapeHtml(category)}</span><span class="place-dot"></span><span class="saved-place-name" title="${escapeHtml(place.name)}">${escapeHtml(place.name)}</span><button class="mini-delete" type="button" data-delete-place="${place.id}" aria-label="${escapeHtml(place.name)} 삭제">×</button></div>`).join('')}</div></section>`;}).join('')||'<div class="empty-small">저장한 장소가 없어요.</div>';}
renderGroupedPlaceList=renderGroupedPlaceListWithAccordion;
document.addEventListener('click',event=>{const toggle=event.target.closest('[data-place-category-toggle]');if(!toggle)return;const category=toggle.dataset.placeCategoryToggle;if(collapsedPlaceCategories.has(category))collapsedPlaceCategories.delete(category);else collapsedPlaceCategories.add(category);renderGroupedPlaceList();});
start();

// Place editing, accordion polish, and the collapsible application rail.
let editingPlaceId='';
const accordionChevron='<svg class="accordion-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"></path></svg>';
function syncPlaceEditor(){
  const form=$('#placeForm');
  if(!form)return;
  const place=tripPlaces().find(item=>item.id===editingPlaceId);
  if(editingPlaceId&&!place)editingPlaceId='';
  const submit=form.querySelector('button[type="submit"]');
  if(!submit)return;
  let actions=form.querySelector('.place-edit-actions');
  if(!actions){actions=document.createElement('div');actions.className='place-edit-actions';form.insertBefore(actions,submit);actions.append(submit);}
  submit.textContent=editingPlaceId?'장소 수정':'장소 저장';
  let cancel=actions.querySelector('[data-cancel-place-edit]');
  if(editingPlaceId&&!cancel){cancel=document.createElement('button');cancel.type='button';cancel.className='place-edit-cancel';cancel.dataset.cancelPlaceEdit='true';cancel.textContent='취소';actions.insertBefore(cancel,submit);}
  if(!editingPlaceId)cancel?.remove();
  document.querySelectorAll('.saved-place').forEach(row=>row.classList.toggle('is-editing',row.dataset.placeId===editingPlaceId));
}
function beginPlaceEdit(placeId){
  const place=tripPlaces().find(item=>item.id===placeId),form=$('#placeForm');
  if(!place||!form)return;
  editingPlaceId=place.id;
  form.elements.name.value=place.name;
  form.elements.category.value=place.category||state.categories.places[0]||'';
  syncPlaceEditor();
  form.elements.name.focus();
  form.elements.name.select();
}
const renderDetailContentBeforePlaceEditor=renderDetailContent;
renderDetailContent=function(){renderDetailContentBeforePlaceEditor();syncPlaceEditor();};
renderGroupedPlaceList=function(){
  const list=$('#placeList');
  if(!list)return;
  const groups=tripPlaces().reduce((map,place)=>{const category=place.category||'기타';(map[category]??=[]).push(place);return map;},{});
  for(const category of collapsedPlaceCategories){if(!groups[category])collapsedPlaceCategories.delete(category);}
  list.innerHTML=Object.entries(groups).map(([category,items])=>{
    const collapsed=collapsedPlaceCategories.has(category);
    return `<section class="saved-place-group"><button class="saved-place-group-toggle" type="button" data-place-category-toggle="${escapeHtml(category)}" aria-expanded="${String(!collapsed)}"><span><strong>${escapeHtml(category)}</strong><small>${items.length}개</small></span>${accordionChevron}</button><div class="saved-place-group-items"${collapsed?' hidden':''}>${items.map(place=>`<div class="saved-place${place.id===editingPlaceId?' is-editing':''}" role="button" tabindex="0" draggable="true" data-place-id="${place.id}" aria-label="${escapeHtml(place.name)} 수정"><span class="saved-place-category">${escapeHtml(category)}</span><span class="place-dot"></span><span class="saved-place-name" title="${escapeHtml(place.name)}">${escapeHtml(place.name)}</span><button class="mini-delete" type="button" data-delete-place="${place.id}" aria-label="${escapeHtml(place.name)} 삭제">×</button></div>`).join('')}</div></section>`;
  }).join('')||'<div class="empty-small">저장한 장소가 없어요.</div>';
};
document.addEventListener('submit',event=>{
  if(event.target.id!=='placeForm'||!editingPlaceId)return;
  const form=event.target,place=tripPlaces().find(item=>item.id===editingPlaceId),data=new FormData(form),name=String(data.get('name')||'').trim();
  if(!place||!name){event.preventDefault();return;}
  event.preventDefault();event.stopImmediatePropagation();
  place.name=name;place.category=String(data.get('category')||place.category||'기타');
  editingPlaceId='';form.reset();save();renderDetailContent();toast('장소 정보를 수정했어요.');
},true);

// Restore the compact bar presentation for spending statistics.
openSpendStats=function(){
  const total=tripSchedule().reduce((sum,item)=>sum+scheduleAmount(item),0),groups={};
  tripSchedule().forEach(item=>{
    const place=tripPlaces().find(saved=>saved.id===item.placeId),category=item.category||place?.category||'기타';
    groups[category]=(groups[category]||0)+scheduleAmount(item);
  });
  const rows=Object.entries(groups).filter(([,amount])=>amount>0).sort((a,b)=>b[1]-a[1]),max=rows[0]?.[1]||1;
  let modal=$('#spendStatsModal');
  if(!modal){
    document.body.insertAdjacentHTML('beforeend','<dialog class="trip-modal spend-stats-modal" id="spendStatsModal"><form class="modal-box"><button class="modal-close" type="button" data-close-spend-stats>×</button><p class="eyebrow">SPENDING INSIGHTS</p><h2>소비 통계</h2><p>일정표에 입력한 소요금액을 카테고리별로 모아봤어요.</p><div id="spendStatsContent"></div><div class="modal-actions"><button class="gradient-button" type="button" data-close-spend-stats>확인</button></div></form></dialog>');
    modal=$('#spendStatsModal');
  }
  const content=$('#spendStatsContent');
  content.innerHTML=rows.length?`<div class="stats-total"><span>총 지출</span><strong>${money(total)}</strong></div><div class="stats-bars">${rows.map(([category,amount])=>`<div class="stats-bar-row"><div><span>${escapeHtml(category)}</span><strong>${money(amount)}</strong></div><div class="stats-bar"><i style="width:${Math.max(8,Math.round(amount/max*100))}%"></i></div></div>`).join('')}</div>`:'<div class="empty-small">입력된 소요금액이 아직 없어요.</div>';
  modal.showModal();
};
document.addEventListener('click',event=>{
  const cancel=event.target.closest('[data-cancel-place-edit]');
  if(cancel){const form=$('#placeForm');editingPlaceId='';form?.reset();syncPlaceEditor();return;}
  const row=event.target.closest('.saved-place[data-place-id]');
  if(row&&!event.target.closest('[data-delete-place]'))beginPlaceEdit(row.dataset.placeId);
});

// Imported JSON must be committed immediately so a refresh can restore it.
importState=async function(file){
  if(!file)return;
  try{
    state=normalize(JSON.parse(await file.text()));
    await commitState();
    if(document.body.dataset.page==='detail')renderDetail();else renderTripList();
    toast('여행 데이터를 가져오고 저장했어요.');
  }catch(error){
    toast('JSON 파일을 읽지 못했어요.');
  }
};
document.addEventListener('keydown',event=>{
  const row=event.target.closest('.saved-place[data-place-id]');
  if(row&&(event.key==='Enter'||event.key===' ')){event.preventDefault();beginPlaceEdit(row.dataset.placeId);}
});
const sideNavCollapsedKey='trip-side-nav-collapsed';
let sideNavCollapsed=(()=>{try{return localStorage.getItem(sideNavCollapsedKey)==='true';}catch(error){return false;}})();
const sideNavToggleIcon='<span class="side-nav-toggle-icon" aria-hidden="true">‹</span>';
sideNavMarkup=function(active){return `<aside class="side-nav"><div class="side-nav-brand"><span class="brand-orb"></span><span>TRIP//LOG</span></div><nav class="side-nav-links" aria-label="주요 메뉴"><button type="button" class="side-nav-link${active==='trips'?' active':''}" data-app-nav="trips"><span>01</span><strong>내 여행</strong></button><button type="button" class="side-nav-link${active==='packing'?' active':''}" data-app-nav="packing"><span>02</span><strong>준비물</strong></button></nav></aside>`;};
mountSideNav=function(active){
  const app=document.querySelector('.trip-app'),main=app?.querySelector('main');
  if(!app||!main)return;
  let layout=app.querySelector('.app-layout'),content=app.querySelector('.app-content');
  if(!layout){layout=document.createElement('div');layout.className='app-layout';content=document.createElement('div');content.className='app-content';main.replaceWith(layout);layout.append(content);content.append(main);}
  layout.querySelector('.side-nav')?.remove();
  layout.insertAdjacentHTML('afterbegin',sideNavMarkup(active));
  layout.classList.toggle('side-nav-collapsed',sideNavCollapsed);
};
document.addEventListener('click',event=>{
  const toggle=event.target.closest('[data-side-nav-toggle]');
  if(!toggle)return;
  sideNavCollapsed=!sideNavCollapsed;
  try{localStorage.setItem(sideNavCollapsedKey,String(sideNavCollapsed));}catch(error){}
  const layout=document.querySelector('.app-layout');
  layout?.classList.toggle('side-nav-collapsed',sideNavCollapsed);
  toggle.setAttribute('aria-expanded',String(!sideNavCollapsed));
  toggle.setAttribute('aria-label',sideNavCollapsed?'네비게이션 펼치기':'네비게이션 접기');
  toggle.title=sideNavCollapsed?'네비게이션 펼치기':'네비게이션 접기';
  toggle.querySelector('.side-nav-toggle-label')?.replaceChildren(document.createTextNode(sideNavCollapsed?'펼치기':'접기'));
  toggle.querySelector('.side-nav-toggle-icon')?.replaceChildren(document.createTextNode(sideNavCollapsed?'›':'‹'));
});
function addScheduleDeleteButtons(){
  document.querySelectorAll('.schedule-table .schedule-col-action').forEach(cell=>{
    if(cell.querySelector('[data-remove-schedule]'))return;
    const row=cell.closest('[data-schedule-id]');
    if(!row)return;
    let group=cell.querySelector('.schedule-action-group');
    if(!group){group=document.createElement('span');group.className='schedule-action-group';while(cell.firstChild)group.append(cell.firstChild);cell.append(group);}
    const button=document.createElement('button');
    button.className='schedule-remove schedule-row-delete';
    button.type='button';
    button.dataset.removeSchedule=row.dataset.scheduleId;
    button.setAttribute('aria-label','일정 삭제');
    button.title='일정 삭제';
    button.textContent='×';
    group.append(button);
  });
}
const renderDetailContentWithScheduleDelete=renderDetailContent;
renderDetailContent=function(){renderDetailContentWithScheduleDelete();addScheduleDeleteButtons();};
document.addEventListener('click',event=>{
  const addButton=event.target.closest('#addCategory');
  if(!addButton)return;
  event.preventDefault();
  event.stopImmediatePropagation();
  const input=$('#categoryName'),value=input?.value.trim();
  if(!value||state.categories[categoryMode].includes(value))return;
  state.categories[categoryMode].push(value);
  if(input)input.value='';
  renderDetailContent();
  const select=$(`#${categoryMode==='places'?'placeCategory':'expenseCategory'}`);
  if(select)select.value=value;
  openCategory(categoryMode);
  commitState();
  toast('카테고리를 추가했어요.');
},true);

// Final bindings are kept at the end because this file contains several UI refinements
// layered over the original renderer.
const normalizeWithPackingCleanup=normalize;
normalize=function(input){
  const result=normalizePackingState(normalizeWithPackingCleanup(input),input);
  cleanupExpiredTripPackingData(result);
  return result;
};
const renderDetailWithPackingFinal=renderDetail;
renderDetail=function(){
  renderDetailWithPackingFinal();
  const main=document.querySelector('.trip-detail-page');
  if(!main)return;
  if(!$('#tripPackingCard'))main.insertAdjacentHTML('beforeend',`<section class="detail-card trip-packing-card" id="tripPackingCard"><div class="detail-card-head"><div><p>TRIP CHECKLIST</p><h2>이번 여행 준비물</h2><p>준비물 모듈을 선택하고, 이번 여행만의 항목도 추가하세요.</p></div><div class="trip-packing-head-actions"><strong id="tripPackingProgress">0 / 0개 챙김</strong><button class="outline-button trip-packing-select-button" type="button" data-open-trip-packing-picker>준비물 선택</button><button class="outline-button trip-packing-custom-button" type="button" data-open-trip-custom-packing>준비물 추가</button></div></div><div id="tripPackingList" class="trip-packing-list"></div></section><dialog class="trip-modal trip-packing-picker-modal" id="tripPackingPickerModal"><form class="modal-box"><button class="modal-close" type="button" data-close-trip-packing-picker>×</button><p class="eyebrow">PACKING MODULES</p><h2>준비물 모듈 선택</h2><p>해외 n박처럼 등록한 준비물 모듈을 선택하세요.</p><div id="tripPackingPickerList" class="trip-packing-picker-list"></div><div class="modal-actions"><button class="gradient-button" type="button" data-close-trip-packing-picker>선택 완료</button></div></form></dialog><dialog class="trip-modal trip-custom-packing-modal" id="tripCustomPackingModal"><form class="modal-box" id="tripCustomPackingForm"><button class="modal-close" type="button" data-close-trip-custom-packing>×</button><p class="eyebrow">TRIP ONLY ITEM</p><h2>이번 여행 준비물 추가</h2><p>준비물 모듈에는 등록하지 않고, 이 여행에서만 사용할 항목을 추가하세요.</p><label>준비물 이름<input class="modal-input" name="name" type="text" maxlength="60" placeholder="예: 현지 유심" required /></label><fieldset class="packing-required-field"><legend>여행에 꼭 필요한가요?</legend><label><input type="radio" name="required" value="required" checked /> 필수</label><label><input type="radio" name="required" value="optional" /> 선택</label></fieldset><div class="modal-actions"><button class="outline-button" type="button" data-close-trip-custom-packing>취소</button><button class="gradient-button" type="submit">이 여행에 추가</button></div></form></dialog>`);
  renderTripPackingPanel();
};

// Packing lists are shared by all trips, while each trip keeps its own checked state.
const PACKING_DEFAULT_CATEGORIES=['의류','전자기기','세면도구','서류','기타'];
const PACKING_EMPTY_STATE={packingCategories:PACKING_DEFAULT_CATEGORIES,packingItems:[],packingLists:[],tripPackingLists:[],tripPackings:[],tripCustomPackings:[]};
const normalizePackingState=(result,input)=>{
  const incoming=input||{},categories=unique(incoming.packingCategories,PACKING_DEFAULT_CATEGORIES),categorySet=new Set(categories);
  result.packingCategories=categories;
  result.packingItems=Array.isArray(incoming.packingItems)?incoming.packingItems.filter(item=>item&&item.name).map(item=>({
    id:String(item.id||uid()),name:String(item.name).trim(),category:categorySet.has(String(item.category||''))?String(item.category):categories[categories.length-1],required:item.required!==false
  })):[];
  const itemIds=new Set(result.packingItems.map(item=>item.id)),tripIds=new Set(result.trips.map(trip=>trip.id));
  result.tripPackings=Array.isArray(incoming.tripPackings)?incoming.tripPackings.filter(item=>item&&tripIds.has(String(item.tripId))&&itemIds.has(String(item.packingItemId))).map(item=>({
   id:String(item.id||uid()),tripId:String(item.tripId),packingItemId:String(item.packingItemId),selected:item.selected!==false,checked:Boolean(item.checked)
  })):[];
  result.tripPackingLists=Array.isArray(incoming.tripPackingLists)?incoming.tripPackingLists.filter(item=>item&&tripIds.has(String(item.tripId))).map(item=>({
    id:String(item.id||uid()),tripId:String(item.tripId),packingListId:String(item.packingListId),selected:item.selected!==false
  })):[];
  result.tripCustomPackings=Array.isArray(incoming.tripCustomPackings)?incoming.tripCustomPackings.filter(item=>item&&tripIds.has(String(item.tripId))&&item.name).map(item=>({
    id:String(item.id||uid()),tripId:String(item.tripId),name:String(item.name).trim(),required:item.required!==false,checked:Boolean(item.checked)
  })):[];
  return result;
};
const normalizeBeforePacking=normalize;
normalize=function(input){return normalizePackingState(normalizeBeforePacking(input),input);};
function cleanupExpiredTripPackingData(){return false;}
function packingCommit(message){
  save();
  commitState();
  if(message)toast(message);
}
function packingCategoryLabel(category){return escapeHtml(category||'기타');}
function packingItemById(id){return state.packingItems.find(item=>item.id===id);}
function packingListByItemId(itemId){return state.packingLists?.find(list=>packingListItems(list.id).some(item=>item.id===itemId));}
function tripPackingEntry(itemId){return state.tripPackings.find(item=>item.tripId===state.activeTripId&&item.packingItemId===itemId);}
function tripPackingModuleEntry(listId){return state.tripPackingLists.find(item=>item.tripId===state.activeTripId&&item.packingListId===listId);}
function tripPackingModuleSelected(listId){const entry=tripPackingModuleEntry(listId);return Boolean(entry&&entry.selected!==false);}
function tripPackingSelected(itemId){const list=packingListByItemId(itemId);return Boolean(list&&tripPackingModuleSelected(list.id));}
function tripPackingChecked(itemId){const entry=tripPackingEntry(itemId);return Boolean(entry&&entry.checked);}
function tripCustomPackingById(id){return state.tripCustomPackings.find(item=>item.id===id&&item.tripId===state.activeTripId);}
function renderPackingItems(){
  const list=$('#packingItemList');
  if(!list)return;
  const groups=state.packingCategories.map(category=>[category,state.packingItems.filter(item=>(item.category||'기타')===category)]).filter(([,items])=>items.length);
  list.innerHTML=groups.length?groups.map(([category,items])=>`<section class="packing-group"><div class="packing-group-head"><strong>${packingCategoryLabel(category)}</strong><span>${items.length}개</span></div><div class="packing-group-items">${items.map(item=>`<article class="packing-library-item" data-packing-item-id="${item.id}"><div class="packing-item-copy"><span class="packing-kind ${item.required?'required':'optional'}">${item.required?'필수':'선택'}</span><strong>${escapeHtml(item.name)}</strong></div><div class="packing-item-actions"><button type="button" class="packing-edit-button" data-edit-packing-item="${item.id}" aria-label="${escapeHtml(item.name)} 수정">수정</button><button type="button" class="packing-delete-button" data-delete-packing-item="${item.id}" aria-label="${escapeHtml(item.name)} 삭제">×</button></div></article>`).join('')}</div></section>`).join(''):'<div class="empty-small">아직 등록한 준비물이 없어요.<br />왼쪽에서 첫 준비물을 추가해 보세요.</div>';
  const count=$('#packingItemCount');
  if(count)count.textContent=`${state.packingItems.length}개 항목`;
  const mirror=$('#packingItemCountMirror');
  if(mirror)mirror.textContent=`${state.packingItems.length}개`;
}
function renderPackingCategoryOptions(selected){
  const select=$('#packingItemCategory');
  if(select)select.innerHTML=state.packingCategories.map(category=>`<option value="${packingCategoryLabel(category)}"${category===selected?' selected':''}>${packingCategoryLabel(category)}</option>`).join('');
}
function resetPackingForm(){
  const form=$('#packingItemForm');
  if(!form)return;
  form.reset();
  form.dataset.editingId='';
  renderPackingCategoryOptions(state.packingCategories[0]);
  const required=form.querySelector('input[value="required"]');
  if(required)required.checked=true;
  const submit=form.querySelector('[data-packing-submit]');
  if(submit)submit.textContent='준비물 추가';
  const cancel=form.querySelector('[data-cancel-packing-edit]');
  cancel?.remove();
}
function beginPackingEdit(id){
  const item=packingItemById(id),form=$('#packingItemForm');
  if(!item||!form)return;
  form.dataset.editingId=item.id;
  form.elements.name.value=item.name;
  renderPackingCategoryOptions(item.category);
  form.querySelector(`input[name="required"][value="${item.required?'required':'optional'}"]`).checked=true;
  const submit=form.querySelector('[data-packing-submit]');
  if(submit)submit.textContent='준비물 수정';
  if(!form.querySelector('[data-cancel-packing-edit]')){
    const cancel=document.createElement('button');cancel.type='button';cancel.className='packing-cancel-button';cancel.dataset.cancelPackingEdit='true';cancel.textContent='취소';
    submit.parentElement.insertBefore(cancel,submit);
  }
  form.elements.name.focus();form.elements.name.select();
}
function renderPackingCategoryList(){
  const list=$('#packingCategoryList');
  if(!list)return;
  list.innerHTML=state.packingCategories.map(category=>`<div class="packing-category-row"><input type="text" value="${packingCategoryLabel(category)}" data-packing-category-input="${packingCategoryLabel(category)}" maxlength="30" /><button type="button" data-save-packing-category="${packingCategoryLabel(category)}">저장</button><button type="button" data-delete-packing-category="${packingCategoryLabel(category)}"${category==='기타'?' disabled':''}>×</button></div>`).join('');
}
function openPackingCategoryModal(){renderPackingCategoryList();$('#packingCategoryModal')?.showModal();}
function renderPacking(){
  document.body.innerHTML=`<div class="trip-app">${header()}<main class="trip-list-page packing-page"><section class="list-intro packing-intro"><div><p class="eyebrow">TRAVEL CHECKLIST</p><h1>준비물</h1><p>여행마다 꺼내 쓸 준비물 목록을 만들고, 여행 페이지에서 체크해 보세요.</p></div><div class="packing-intro-actions"><span class="packing-library-count" id="packingItemCount">0개 항목</span><button class="outline-button" type="button" data-open-packing-categories>카테고리 관리</button></div></section><div class="packing-layout"><section class="detail-card packing-editor-card"><div class="detail-card-head"><div><p>PACKING LIBRARY</p><h2>준비물 등록</h2></div><span class="section-icon">＋</span></div><form id="packingItemForm" class="detail-form"><label>준비물 이름<input name="name" type="text" maxlength="60" placeholder="예: 여권, 충전기" required /></label><label>카테고리<div class="manage-row"><select name="category" id="packingItemCategory"></select><button type="button" class="small-plus" data-open-packing-categories aria-label="준비물 카테고리 관리">＋</button></div></label><fieldset class="packing-required-field"><legend>여행에 꼭 필요한가요?</legend><label><input type="radio" name="required" value="required" checked /> 필수</label><label><input type="radio" name="required" value="optional" /> 선택</label></fieldset><div class="packing-form-actions"><button class="gradient-button" type="submit" data-packing-submit>준비물 추가</button></div></form><p class="packing-editor-help">왼쪽에서 항목을 추가하면 오른쪽 목록에 저장됩니다. 오른쪽 항목을 눌러 수정할 수 있어요.</p></section><section class="detail-card packing-library-card"><div class="detail-card-head"><div><p>MY PACKING LIST</p><h2>등록한 준비물</h2></div><strong class="packing-list-count" id="packingItemCountMirror">0개</strong></div><div class="packing-item-list" id="packingItemList"></div></section></div></main><dialog class="trip-modal" id="packingCategoryModal"><form class="modal-box" id="packingCategoryForm"><button class="modal-close" type="button" data-close-packing-category>×</button><p class="eyebrow">PACKING CATEGORY</p><h2>준비물 카테고리</h2><p>카테고리를 추가하거나 이름을 수정할 수 있어요.</p><div class="packing-category-add"><input id="newPackingCategory" type="text" maxlength="30" placeholder="새 카테고리 이름" /><button type="button" class="small-plus" data-add-packing-category>＋</button></div><div class="packing-category-list" id="packingCategoryList"></div><div class="modal-actions"><button class="gradient-button" type="button" data-close-packing-category>완료</button></div></form></dialog><div class="toast" id="toast" role="status" aria-live="polite"></div></div>`;
  renderPackingCategoryOptions(state.packingCategories[0]);renderPackingItems();
  const mirror=$('#packingItemCountMirror');if(mirror)mirror.textContent=`${state.packingItems.length}개`;
  mountSideNav('packing');
}
function renderTripPackingPanel(){
  const card=$('#tripPackingCard');
  if(!card)return;
  const checked=state.packingItems.filter(item=>tripPackingChecked(item.id)).length,total=state.packingItems.length;
  const progress=$('#tripPackingProgress');if(progress)progress.textContent=`${checked} / ${total}개 챙김`;
  const list=$('#tripPackingList');
  const groups=state.packingCategories.map(category=>[category,state.packingItems.filter(item=>(item.category||'기타')===category)]).filter(([,items])=>items.length);
  list.innerHTML=groups.length?groups.map(([category,items])=>`<section class="trip-packing-group"><div class="packing-group-head"><strong>${packingCategoryLabel(category)}</strong><span>${items.filter(item=>tripPackingChecked(item.id)).length}/${items.length}</span></div><div class="trip-packing-items">${items.map(item=>`<label class="trip-packing-item${tripPackingChecked(item.id)?' is-checked':''}"><input type="checkbox" data-trip-packing-check="${item.id}"${tripPackingChecked(item.id)?' checked':''} /><span class="trip-packing-checkmark"></span><span class="trip-packing-name">${escapeHtml(item.name)}</span><span class="packing-kind ${item.required?'required':'optional'}">${item.required?'필수':'선택'}</span></label>`).join('')}</div></section>`).join(''):'<div class="empty-small">등록한 준비물이 없어요.<br />준비물 메뉴에서 먼저 목록을 만들어 주세요.</div>';
}
const legacyRenderDetailForPacking=renderDetail;
renderDetail=function(){legacyRenderDetailForPacking();const main=document.querySelector('.trip-detail-page');if(!main)return;if(!$('#tripPackingCard'))main.insertAdjacentHTML('beforeend',`<section class="detail-card trip-packing-card" id="tripPackingCard"><div class="detail-card-head"><div><p>TRIP CHECKLIST</p><h2>이번 여행 준비물</h2><p>등록한 준비물 중 이번 여행에 필요한 항목을 선택하세요.</p></div><div class="trip-packing-head-actions"><strong id="tripPackingProgress">0 / 0개 챙김</strong><button class="outline-button trip-packing-select-button" type="button" data-open-trip-packing-picker>준비물 선택</button></div></div><div id="tripPackingList" class="trip-packing-list"></div></section><dialog class="trip-modal trip-packing-picker-modal" id="tripPackingPickerModal"><form class="modal-box"><button class="modal-close" type="button" data-close-trip-packing-picker>×</button><p class="eyebrow">TRIP CHECKLIST</p><h2>이번 여행 준비물 선택</h2><p>등록한 준비물 목록에서 이 여행에 챙길 항목을 선택하세요.</p><div id="tripPackingPickerList" class="trip-packing-picker-list"></div><div class="modal-actions"><button class="gradient-button" type="button" data-close-trip-packing-picker>선택 완료</button></div></form></dialog>`);renderTripPackingPanel();};
function removePackingItem(id){
  const item=packingItemById(id);if(!item)return;
  state.packingItems=state.packingItems.filter(saved=>saved.id!==id);state.tripPackings=state.tripPackings.filter(saved=>saved.packingItemId!==id);resetPackingForm();renderPackingItems();packingCommit('준비물 항목을 삭제했어요.');
}
document.addEventListener('submit',event=>{
  if(event.target.id!=='packingItemForm')return;
  event.preventDefault();const form=event.target,name=String(form.elements.name.value||'').trim();if(!name)return;
  const data=new FormData(form),id=form.dataset.editingId,category=String(data.get('category')||state.packingCategories[0]),required=data.get('required')==='required';
  if(id){const item=packingItemById(id);if(item){item.name=name;item.category=category;item.required=required;}toast('준비물을 수정했어요.');}
  else{state.packingItems.push({id:uid(),name,category,required});toast('준비물을 추가했어요.');}
  resetPackingForm();renderPackingItems();packingCommit();
});
document.addEventListener('click',event=>{
  if(event.target.closest('[data-close-packing-item-edit]')){$('#packingItemEditModal')?.close();return;}
  const edit=event.target.closest('[data-edit-packing-item]');if(edit){openPackingItemEditModal(edit.dataset.editPackingItem);return;}
  const del=event.target.closest('[data-delete-packing-item]');if(del){removePackingItem(del.dataset.deletePackingItem);return;}
  if(event.target.closest('[data-cancel-packing-edit]')){resetPackingForm();return;}
  if(event.target.closest('[data-open-packing-categories]')){openPackingCategoryModal();return;}
  if(event.target.closest('[data-close-packing-category]')){$('#packingCategoryModal')?.close();return;}
  const add=event.target.closest('[data-add-packing-category]');if(add){const input=$('#newPackingCategory'),value=input?.value.trim();if(!value||state.packingCategories.includes(value))return;state.packingCategories.push(value);if(input)input.value='';renderPackingCategoryList();renderPackingCategoryOptions(value);packingCommit('카테고리를 추가했어요.');return;}
  const saveCategory=event.target.closest('[data-save-packing-category]');if(saveCategory){const old=saveCategory.dataset.savePackingCategory,row=saveCategory.closest('.packing-category-row'),input=row?.querySelector('input'),value=input?.value.trim();if(!value||state.packingCategories.includes(value)&&value!==old)return;const index=state.packingCategories.indexOf(old);if(index<0)return;state.packingCategories[index]=value;state.packingItems.forEach(item=>{if(item.category===old)item.category=value;});renderPackingCategoryList();renderPackingCategoryOptions(value);renderPackingItems();packingCommit('카테고리를 수정했어요.');return;}
  const deleteCategory=event.target.closest('[data-delete-packing-category]');if(deleteCategory){const category=deleteCategory.dataset.deletePackingCategory;if(category==='기타')return;state.packingCategories=state.packingCategories.filter(item=>item!==category);state.packingItems.forEach(item=>{if(item.category===category)item.category='기타';});renderPackingCategoryList();renderPackingCategoryOptions('기타');renderPackingItems();packingCommit('카테고리를 삭제하고 기타로 옮겼어요.');}
});
document.addEventListener('click',event=>{
  const nav=event.target.closest('[data-app-nav]');if(!nav||nav.dataset.appNav!=='packing')return;
  setTimeout(()=>{renderPackingItems();},0);
});
document.addEventListener('click',event=>{
  if(event.target.closest('[data-open-trip-packing-picker]')){renderTripPackingPicker();$('#tripPackingPickerModal')?.showModal();return;}
  if(event.target.closest('[data-close-trip-packing-picker]')){$('#tripPackingPickerModal')?.close();return;}
  if(event.target.closest('[data-open-trip-custom-packing]')){$('#tripCustomPackingForm')?.reset();$('#tripCustomPackingModal')?.showModal();return;}
  if(event.target.closest('[data-close-trip-custom-packing]')){$('#tripCustomPackingModal')?.close();return;}
  const deleteCustom=event.target.closest('[data-delete-trip-custom-packing]');
  if(deleteCustom){event.preventDefault();event.stopPropagation();state.tripCustomPackings=state.tripCustomPackings.filter(item=>item.id!==deleteCustom.dataset.deleteTripCustomPacking);renderTripPackingPanel();packingCommit('이번 여행 전용 준비물을 삭제했어요.');}
});
function updateTripPackingModule(moduleId,selected){
  const existing=state.tripPackingLists.find(item=>item.tripId===state.activeTripId&&item.packingListId===moduleId);
  if(selected){if(existing)existing.selected=true;else state.tripPackingLists.push({id:uid(),tripId:state.activeTripId,packingListId:moduleId,selected:true});}
  else state.tripPackingLists=state.tripPackingLists.filter(item=>!(item.tripId===state.activeTripId&&item.packingListId===moduleId));
  renderTripPackingPanel();packingCommit();
}
function updateTripPackingItem(itemId,checked){
  const existing=state.tripPackings.find(item=>item.tripId===state.activeTripId&&item.packingItemId===itemId);
  if(existing)existing.checked=checked;else state.tripPackings.push({id:uid(),tripId:state.activeTripId,packingItemId:itemId,selected:true,checked});
  renderTripPackingPanel();packingCommit();
}
document.addEventListener('click',event=>{
  const pickerItem=event.target.closest('.trip-packing-picker-item'),input=pickerItem?.querySelector('[data-trip-packing-module-select]');
  if(!input)return;
  setTimeout(()=>updateTripPackingModule(input.dataset.tripPackingModuleSelect,input.checked),0);
});
document.addEventListener('change',event=>{
  const selection=event.target.closest('[data-trip-packing-module-select]');
  if(selection){updateTripPackingModule(selection.dataset.tripPackingModuleSelect,selection.checked);return;}
  const checkbox=event.target.closest('[data-trip-packing-check]');
  if(checkbox){updateTripPackingItem(checkbox.dataset.tripPackingCheck,checkbox.checked);return;}
  const customCheckbox=event.target.closest('[data-trip-custom-packing-check]');
  if(customCheckbox){const item=tripCustomPackingById(customCheckbox.dataset.tripCustomPackingCheck);if(item){item.checked=customCheckbox.checked;renderTripPackingPanel();packingCommit();}}
});
document.addEventListener('submit',event=>{
  if(event.target.id!=='tripCustomPackingForm')return;
  event.preventDefault();const form=event.target,name=String(form.elements.name.value||'').trim();if(!name)return;
  state.tripCustomPackings.push({id:uid(),tripId:state.activeTripId,name,required:form.elements.required.value==='required',checked:false});
  form.reset();form.querySelector('input[value="required"]').checked=true;$('#tripCustomPackingModal')?.close();renderTripPackingPanel();packingCommit('이번 여행 전용 준비물을 추가했어요.');
});
function initializePackingState(){
  if(!Array.isArray(state.packingCategories))state.packingCategories=[...PACKING_DEFAULT_CATEGORIES];
  if(!Array.isArray(state.packingItems))state.packingItems=[];
  if(!Array.isArray(state.tripPackings))state.tripPackings=[];
  if(cleanupExpiredTripPackingData(state))commitState();
}
initializePackingState();
if(isNativeAndroid()){
  try{const raw=window.TripDb.loadState();if(raw){state=normalize(JSON.parse(raw));initializePackingState();if(document.querySelector('.trip-app')){if(document.querySelector('#tripPackingCard'))renderDetail();else renderTripList();}}}catch(error){}
}
let mobileSideNavOpen=false;
function syncMobileSideNav(){
  const layout=document.querySelector('.app-layout'),trigger=document.querySelector('[data-mobile-nav-toggle]');
  if(!layout||!trigger)return;
  layout.classList.toggle('side-nav-open',mobileSideNavOpen);
  trigger.setAttribute('aria-expanded',String(mobileSideNavOpen));
  trigger.setAttribute('aria-label',mobileSideNavOpen?'네비게이션 닫기':'네비게이션 열기');
  trigger.title=mobileSideNavOpen?'네비게이션 닫기':'네비게이션 열기';
  trigger.textContent=mobileSideNavOpen?'×':'☰';
}
const mountSideNavBeforeMobileDrawer=mountSideNav;
mountSideNav=function(active){
  mountSideNavBeforeMobileDrawer(active);
  const layout=document.querySelector('.app-layout');
  if(!layout)return;
  if(!layout.querySelector('.side-nav-scrim'))layout.insertAdjacentHTML('beforeend','<div class="side-nav-scrim" data-mobile-nav-scrim aria-hidden="true"></div>');
  syncMobileSideNav();
};
document.addEventListener('click',event=>{
  if(event.target.closest('[data-mobile-nav-toggle]')){mobileSideNavOpen=!mobileSideNavOpen;syncMobileSideNav();return;}
  if(event.target.closest('[data-mobile-nav-scrim]')){mobileSideNavOpen=false;syncMobileSideNav();return;}
  if(event.target.closest('[data-app-nav]')){mobileSideNavOpen=false;syncMobileSideNav();}
});
const revealLoadedPage=()=>document.documentElement.classList.remove('page-loading');
const renderTripListBeforePageReveal=renderTripList;
renderTripList=function(){renderTripListBeforePageReveal();revealLoadedPage();};
if(document.querySelector('.trip-app'))revealLoadedPage();

// Keep the existing violet-to-pink palette while presenting spending as a donut.
openSpendStats=function(){
  const total=tripSchedule().reduce((sum,item)=>sum+scheduleAmount(item),0),groups={};
  tripSchedule().forEach(item=>{
    const place=tripPlaces().find(saved=>saved.id===item.placeId),category=item.category||place?.category||'기타';
    groups[category]=(groups[category]||0)+scheduleAmount(item);
  });
  const rows=Object.entries(groups).filter(([,amount])=>amount>0).sort((a,b)=>b[1]-a[1]),chartTotal=rows.reduce((sum,[,amount])=>sum+amount,0)||1,max=rows[0]?.[1]||1;
  const palette=['#6657d8','#ef9fbd','#8174df','#e8aac5','#a69ce8','#f1c8da'];
  let cursor=0;
  const segments=rows.map(([category,amount],index)=>{
    const start=cursor,end=index===rows.length-1?100:cursor+amount/chartTotal*100;
    cursor=end;
    return `${palette[index%palette.length]} ${start}% ${end}%`;
  }).join(',');
  let modal=$('#spendStatsModal');
  if(!modal){
    document.body.insertAdjacentHTML('beforeend','<dialog class="trip-modal spend-stats-modal" id="spendStatsModal"><form class="modal-box"><button class="modal-close" type="button" data-close-spend-stats>×</button><p class="eyebrow">SPENDING INSIGHTS</p><h2>소비 통계</h2><p>일정표에 입력한 소요금액을 카테고리별로 모아봤어요.</p><div id="spendStatsContent"></div><div class="modal-actions"><button class="gradient-button" type="button" data-close-spend-stats>확인</button></div></form></dialog>');
    modal=$('#spendStatsModal');
  }
  const content=$('#spendStatsContent');
  content.innerHTML=rows.length?`<div class="stats-total"><span>총 지출</span><strong>${money(total)}</strong></div><div class="stats-bars">${rows.map(([category,amount])=>`<div class="stats-bar-row"><div><span>${escapeHtml(category)}</span><strong>${money(amount)}</strong></div><div class="stats-bar"><i style="width:${Math.max(8,Math.round(amount/max*100))}%"></i></div></div>`).join('')}</div>`:'<div class="empty-small">입력된 소요금액이 아직 없어요.</div>';
  modal.showModal();
};

function deleteConfirm(title,text){
  if(window.Swal?.fire){
    return window.Swal.fire({
      title,
      text,
      icon:'warning',
      showCancelButton:true,
      confirmButtonText:'삭제하기',
      cancelButtonText:'취소',
      confirmButtonColor:'#6657d8',
      cancelButtonColor:'#a5adbd',
      reverseButtons:true,
      focusCancel:true
    }).then(result=>result.isConfirmed);
  }
  return Promise.resolve(window.confirm(`${title}\n${text}`));
}
function deleteNotice(text){
  if(window.Swal?.fire){
    window.Swal.fire({icon:'success',title:'삭제했어요',text,confirmButtonText:'확인',confirmButtonColor:'#6657d8',timer:1600});
    return;
  }
  toast(text);
}
function removeTrip(tripId){
  const trip=state.trips.find(item=>item.id===tripId);
  if(!trip)return;
  state.trips=state.trips.filter(item=>item.id!==tripId);
  state.places=state.places.filter(item=>item.tripId!==tripId);
  state.dates=state.dates.filter(item=>item.tripId!==tripId);
  state.schedule=state.schedule.filter(item=>item.tripId!==tripId);
  state.expenses=state.expenses.filter(item=>item.tripId!==tripId);
  state.tripPackingLists=state.tripPackingLists.filter(item=>item.tripId!==tripId);
  state.tripPackings=state.tripPackings.filter(item=>item.tripId!==tripId);
  state.tripCustomPackings=state.tripCustomPackings.filter(item=>item.tripId!==tripId);
  state.activeTripId=state.trips[0]?.id||'';
  save();
  renderTripList();
  deleteNotice('여행과 관련된 장소, 일정, 경비를 모두 삭제했어요.');
}
function removeSchedule(scheduleId){
  state.schedule=state.schedule.filter(item=>item.id!==scheduleId);
  save();
  renderDetailContent();
  deleteNotice('일정을 삭제했어요.');
}
function removeDate(dateId){
  state.dates=state.dates.filter(item=>item.id!==dateId);
  state.schedule=state.schedule.filter(item=>item.dateId!==dateId);
  save();
  renderDetailContent();
  deleteNotice('날짜와 해당 일정들을 삭제했어요.');
}
document.addEventListener('click',event=>{
  const tripButton=event.target.closest('[data-delete-trip]');
  const scheduleButton=event.target.closest('[data-remove-schedule]');
  const dateButton=event.target.closest('[data-delete-date]');
  if(!tripButton&&!scheduleButton&&!dateButton)return;
  event.preventDefault();
  event.stopImmediatePropagation();
  if(tripButton){
    const trip=state.trips.find(item=>item.id===tripButton.dataset.deleteTrip);
    if(!trip)return;
    deleteConfirm(`'${trip.name}' 여행을 삭제할까요?`,'장소, 일정, 경비도 함께 삭제됩니다.')
      .then(confirmed=>{if(confirmed)removeTrip(trip.id);});
    return;
  }
  if(scheduleButton){
    const item=state.schedule.find(schedule=>schedule.id===scheduleButton.dataset.removeSchedule);
    const place=tripPlaces().find(saved=>saved.id===item?.placeId);
    const name=item?.placeName||place?.name||'이 일정';
    deleteConfirm(`'${name}' 일정을 삭제할까요?`,'삭제한 일정은 복구할 수 없습니다.')
      .then(confirmed=>{if(confirmed&&item)removeSchedule(item.id);});
    return;
  }
  const date=state.dates.find(item=>item.id===dateButton.dataset.deleteDate);
  if(!date)return;
  const count=state.schedule.filter(item=>item.dateId===date.id).length;
  deleteConfirm(`${date.value} 날짜를 삭제할까요?`,count?`${count}개의 일정도 함께 삭제됩니다.`:'해당 날짜를 삭제합니다.')
    .then(confirmed=>{if(confirmed)removeDate(date.id);});
},true);

// Final packing hooks: this file intentionally keeps legacy render refinements above.
const normalizeWithPackingCleanupFinal=normalize;
normalize=function(input){
  const result=normalizePackingState(normalizeWithPackingCleanupFinal(input),input);
  cleanupExpiredTripPackingData(result);
  return result;
};
const renderDetailWithPackingFinalFinal=renderDetail;
renderDetail=function(){
  renderDetailWithPackingFinalFinal();
  const main=document.querySelector('.trip-detail-page');
  if(!main)return;
  if(!$('#tripPackingCard'))main.insertAdjacentHTML('beforeend',`<section class="detail-card trip-packing-card" id="tripPackingCard"><div class="detail-card-head"><div><p>TRIP CHECKLIST</p><h2>이번 여행 준비물</h2><p>준비물 모듈을 선택하고, 이번 여행만의 항목도 추가하세요.</p></div><div class="trip-packing-head-actions"><strong id="tripPackingProgress">0 / 0개 챙김</strong><button class="outline-button trip-packing-select-button" type="button" data-open-trip-packing-picker>준비물 선택</button><button class="outline-button trip-packing-custom-button" type="button" data-open-trip-custom-packing>준비물 추가</button></div></div><div id="tripPackingList" class="trip-packing-list"></div></section><dialog class="trip-modal trip-packing-picker-modal" id="tripPackingPickerModal"><form class="modal-box"><button class="modal-close" type="button" data-close-trip-packing-picker>×</button><p class="eyebrow">PACKING MODULES</p><h2>준비물 모듈 선택</h2><p>해외 n박처럼 등록한 준비물 모듈을 선택하세요.</p><div id="tripPackingPickerList" class="trip-packing-picker-list"></div><div class="modal-actions"><button class="gradient-button" type="button" data-close-trip-packing-picker>선택 완료</button></div></form></dialog><dialog class="trip-modal trip-custom-packing-modal" id="tripCustomPackingModal"><form class="modal-box" id="tripCustomPackingForm"><button class="modal-close" type="button" data-close-trip-custom-packing>×</button><p class="eyebrow">TRIP ONLY ITEM</p><h2>이번 여행 준비물 추가</h2><p>준비물 모듈에는 등록하지 않고, 이 여행에서만 사용할 항목을 추가하세요.</p><label>준비물 이름<input class="modal-input" name="name" type="text" maxlength="60" placeholder="예: 현지 유심" required /></label><fieldset class="packing-required-field"><legend>여행에 꼭 필요한가요?</legend><label><input type="radio" name="required" value="required" checked /> 필수</label><label><input type="radio" name="required" value="optional" /> 선택</label></fieldset><div class="modal-actions"><button class="outline-button" type="button" data-close-trip-custom-packing>취소</button><button class="gradient-button" type="submit">이 여행에 추가</button></div></form></dialog>`);
  renderTripPackingPanel();
};
const renderTripListWithPackingCleanup=renderTripList;
renderTripList=function(){
  initializePackingState();
  renderTripListWithPackingCleanup();
};

// Keep the current client-rendered screen in the URL so F5 restores the same view.
function routeTo(url){history.pushState({},'',url);renderTripList();}
function routeToTripList(){routeTo('index.html');}
function routeToPackingList(){routeTo('index.html?view=packing');}
function routeToPackingEditor(id){
  const params=new URLSearchParams({view:'packing-edit'});
  if(id)params.set('item',id);
  routeTo(`index.html?${params.toString()}`);
}
const renderTripListWithUrlState=renderTripList;
renderTripList=function(){
  initializePackingState();
  const params=new URLSearchParams(window.location.search),file=window.location.pathname.split('/').pop()||'index.html',view=params.get('view');
  if(file==='trip.html'&&params.get('trip')){
    const tripId=params.get('trip');
    if(!state.trips.some(trip=>trip.id===tripId)){routeToTripList();return;}
    state.activeTripId=tripId;document.body.dataset.page='detail';renderDetail();revealLoadedPage();return;
  }
  if(view==='packing-edit'){document.body.dataset.page='packing';renderPackingEditor(params.get('item')||'');revealLoadedPage();return;}
  if(view==='packing'){document.body.dataset.page='packing';renderPacking();revealLoadedPage();return;}
  document.body.dataset.page='list';
  renderTripListWithUrlState();
  revealLoadedPage();
};
window.addEventListener('popstate',()=>renderTripList());
document.addEventListener('click',event=>{
  const nav=event.target.closest('[data-app-nav]');
  if(nav){if(nav.dataset.appNav==='packing')routeToPackingList();else routeToTripList();return;}
  if(event.target.closest('[data-new-packing]')){routeToPackingEditor();return;}
  if(event.target.closest('[data-back-packing-list]')){routeToPackingList();return;}
  const edit=event.target.closest('[data-edit-packing-item]');
  if(edit){openPackingItemEditModal(edit.dataset.editPackingItem);return;}
  const card=event.target.closest('.packing-card[data-packing-item-id]');
  if(card&&!event.target.closest('button'))routeToPackingEditor(card.dataset.packingItemId);
});

// Packing is organized as named lists, e.g. "해외 1박 2일 준비물" → 여권, 충전기.
let activePackingListId='';
function packingListById(id){return state.packingLists?.find(list=>list.id===id);}
function packingListItems(listId){return state.packingItems.filter(item=>item.listId===listId);}
function normalizePackingListsState(result,input){
  const incoming=input||{},rawLists=Array.isArray(incoming.packingLists)?incoming.packingLists:[],rawItems=Array.isArray(incoming.packingItems)?incoming.packingItems:[];
  const nestedItems=rawLists.flatMap(list=>Array.isArray(list.items)?list.items.map(item=>({...item,listId:item.listId||list.id})):[]);
  if(!result.packingItems.length&&nestedItems.length){
    result.packingItems=nestedItems.filter(item=>item&&item.name).map(item=>({id:String(item.id||uid()),name:String(item.name).trim(),category:String(item.category||result.packingCategories[0]||'기타'),required:item.required!==false,listId:String(item.listId)}));
  }
  const lists=rawLists.filter(list=>list&&list.name).map(list=>({id:String(list.id||uid()),name:String(list.name).trim()}));
  const firstListId=lists[0]?.id||'packing-default';
  if(!lists.length&&result.packingItems.length)lists.push({id:firstListId,name:'나의 준비물'});
  const knownLists=new Set(lists.map(list=>list.id));
  const rawById=new Map([...rawItems,...nestedItems].filter(item=>item?.id).map(item=>[String(item.id),item]));
  result.packingItems=result.packingItems.map(item=>{
    const raw=rawById.get(String(item.id)),requested=String(raw?.listId||item.listId||firstListId);
    if(!knownLists.has(requested)){lists.push({id:requested,name:'나의 준비물'});knownLists.add(requested);}
    return {...item,listId:requested};
  });
  result.packingLists=lists;
  const listIds=new Set(lists.map(list=>list.id)),itemsById=new Map(result.packingItems.map(item=>[item.id,item])),moduleKeys=new Set();
  result.tripPackingLists=(result.tripPackingLists||[]).filter(item=>listIds.has(item.packingListId)).map(item=>{const key=`${item.tripId}:${item.packingListId}`;moduleKeys.add(key);return item;});
  result.tripPackings.forEach(item=>{
    const listId=itemsById.get(item.packingItemId)?.listId,key=listId?`${item.tripId}:${listId}`:'';
    if(item.selected!==false&&listId&&!moduleKeys.has(key)){result.tripPackingLists.push({id:uid(),tripId:item.tripId,packingListId:listId,selected:true});moduleKeys.add(key);}
  });
  return result;
}
const normalizeWithPackingLists=normalize;
normalize=function(input){return normalizePackingListsState(normalizeWithPackingLists(input),input);};
const initializePackingStateWithLists=initializePackingState;
initializePackingState=function(){
  if(!Array.isArray(state.packingLists))state.packingLists=[];
  if(!Array.isArray(state.tripPackingLists))state.tripPackingLists=[];
  if(!Array.isArray(state.tripCustomPackings))state.tripCustomPackings=[];
  if(state.packingItems.length&&!state.packingLists.length)state.packingLists.push({id:'packing-default',name:'나의 준비물'});
  const defaultListId=state.packingLists[0]?.id||'';
  state.packingItems.forEach(item=>{if(!item.listId)item.listId=defaultListId;});
  initializePackingStateWithLists();
};
function renderPackingItems(){
  const list=$('#packingItemList');if(!list)return;
  const items=packingListItems(activePackingListId),groups=state.packingCategories.map(category=>[category,items.filter(item=>(item.category||'기타')===category)]).filter(([,group])=>group.length);
  list.innerHTML=groups.length?groups.map(([category,group])=>`<section class="packing-group"><div class="packing-group-head"><strong>${packingCategoryLabel(category)}</strong><span>${group.length}개</span></div><div class="packing-group-items">${group.map(item=>`<article class="packing-library-item" data-packing-item-id="${item.id}"><div class="packing-item-copy"><span class="packing-kind ${item.required?'required':'optional'}">${item.required?'필수':'선택'}</span><strong>${escapeHtml(item.name)}</strong></div><div class="packing-item-actions"><button type="button" class="packing-edit-button" data-edit-packing-item="${item.id}" aria-label="${escapeHtml(item.name)} 수정">수정</button><button type="button" class="packing-delete-button" data-delete-packing-item="${item.id}" aria-label="${escapeHtml(item.name)} 삭제">×</button></div></article>`).join('')}</div></section>`).join(''):'<div class="empty-small">아직 등록한 준비물이 없어요.<br />왼쪽에서 항목을 추가해 보세요.</div>';
  const count=$('#packingItemCountMirror');if(count)count.textContent=`${items.length}개`;
}
function packingListEditorMarkup(list){
  const editing=Boolean(list);
  document.body.innerHTML=`<div class="trip-app">${header()}<main class="trip-detail-page packing-editor-page packing-list-editor-page"><div class="detail-topbar"><button class="back-button" type="button" data-back-packing-list>← 준비물 목록</button></div><section class="detail-title-wrap"><div><p class="eyebrow">PACKING COLLECTION</p><h1>${editing?escapeHtml(list.name):'새 준비물 목록'}</h1><p>목록 이름을 정하고, 안에 필요한 준비물을 추가하세요.</p></div><span class="packing-editor-badge">${editing?'EDIT LIST':'NEW LIST'}</span></section><form class="packing-list-name-editor" id="packingListForm"><label>준비물 목록 이름<input id="packingListName" name="name" type="text" maxlength="60" placeholder="예: 해외 1박 2일 준비물" value="${editing?escapeHtml(list.name):''}" required /></label><button class="gradient-button" type="submit">${editing?'목록 이름 저장':'목록 만들기'}</button></form><div class="packing-layout packing-editor-layout">${packingFormMarkup()}${packingListCardMarkup()}</div></main>${packingCategoryModalMarkup()}<div class="toast" id="toast" role="status" aria-live="polite"></div></div>`;
  activePackingListId=list?.id||'';
  renderPackingCategoryOptions(state.packingCategories[0]);
  renderPackingItems();
  mountSideNav('packing');
}
renderPacking=function(){
  initializePackingState();
  document.body.innerHTML=`<div class="trip-app">${header()}<main class="trip-list-page packing-page"><section class="list-intro"><div><p class="eyebrow">TRAVEL CHECKLIST</p><h1>준비물</h1><p>준비물 목록을 만들고, 목록 안에 필요한 항목을 정리하세요.</p></div><button class="gradient-button" type="button" data-new-packing>＋ 준비물 목록 등록</button></section><section class="trip-grid packing-grid" id="packingGrid">${state.packingLists.length?state.packingLists.map((list,index)=>{const items=packingListItems(list.id),required=items.filter(item=>item.required).length;return`<article class="trip-card packing-card" data-packing-list-id="${list.id}"><span class="trip-card-accent"></span><div class="trip-card-top"><span class="trip-card-number">${String(index+1).padStart(2,'0')}</span><button class="trip-card-edit" type="button" data-edit-packing-list="${list.id}" aria-label="${escapeHtml(list.name)} 수정">✎</button></div><h2>${escapeHtml(list.name)}</h2><div class="trip-card-meta"><span>${items.length}개 준비물</span><span>필수 ${required}개</span></div></article>`;}).join(''):'<div class="empty-page"><strong>아직 준비물 목록이 없어요</strong>예: 해외 1박 2일 준비물 목록을 만들어보세요.</div>'}</section><footer class="trip-footer">목록별 준비물은 모든 여행에서 선택해 사용할 수 있어요.</footer></main>${packingCategoryModalMarkup()}<div class="toast" id="toast" role="status" aria-live="polite"></div></div>`;
  mountSideNav('packing');
};
renderPackingEditor=function(id){packingListEditorMarkup(packingListById(id));};
const renderTripPackingPanelWithLists=renderTripPackingPanel;
function renderTripPackingPicker(){
  const list=$('#tripPackingPickerList');
  if(!list)return;
  const groups=(state.packingLists||[]).map(packingList=>[packingList,packingListItems(packingList.id)]).filter(([,items])=>items.length);
  list.innerHTML=groups.length?groups.map(([packingList,items])=>`<label class="trip-packing-picker-item"><input type="checkbox" data-trip-packing-module-select="${packingList.id}"${tripPackingModuleSelected(packingList.id)?' checked':''} /><span class="trip-packing-checkmark"></span><span class="trip-packing-picker-copy"><strong>${escapeHtml(packingList.name)}</strong><small>${items.length}개 준비물</small></span></label>`).join(''):'<div class="empty-small">등록한 준비물 모듈이 없어요.<br />준비물 메뉴에서 먼저 목록을 만들어 주세요.</div>';
}
renderTripPackingPanel=function(){
  const card=$('#tripPackingCard');if(!card)return;
  const selectedLists=(state.packingLists||[]).filter(list=>tripPackingModuleSelected(list.id)),selectedItems=selectedLists.flatMap(list=>packingListItems(list.id)),customItems=state.tripCustomPackings.filter(item=>item.tripId===state.activeTripId),checked=selectedItems.filter(item=>tripPackingChecked(item.id)).length+customItems.filter(item=>item.checked).length,total=selectedItems.length+customItems.length;
  const progress=$('#tripPackingProgress');if(progress)progress.textContent=`${checked} / ${total}개 챙김`;
  const list=$('#tripPackingList');
  const categoryGroups=state.packingCategories.map(category=>[category,selectedItems.filter(item=>(item.category||'기타')===category)]).filter(([,items])=>items.length);
  const moduleMarkup=categoryGroups.map(([category,items])=>`<section class="trip-packing-group"><div class="packing-group-head"><strong>${packingCategoryLabel(category)}</strong><span>${items.filter(item=>tripPackingChecked(item.id)).length}/${items.length}</span></div><div class="trip-packing-items">${items.map(item=>`<label class="trip-packing-item${tripPackingChecked(item.id)?' is-checked':''}"><input type="checkbox" data-trip-packing-check="${item.id}"${tripPackingChecked(item.id)?' checked':''} /><span class="trip-packing-checkmark"></span><span class="packing-kind ${item.required?'required':'optional'}">${item.required?'필수':'선택'}</span><span class="trip-packing-name">${escapeHtml(item.name)}</span></label>`).join('')}</div></section>`).join('');
  const customMarkup=customItems.length?`<section class="trip-packing-group trip-custom-packing-group"><div class="packing-group-head"><strong>여행별 추가 준비물</strong><span>${customItems.filter(item=>item.checked).length}/${customItems.length}</span></div><div class="trip-packing-items">${customItems.map(item=>`<label class="trip-packing-item${item.checked?' is-checked':''}"><input type="checkbox" data-trip-custom-packing-check="${item.id}"${item.checked?' checked':''} /><span class="trip-packing-checkmark"></span><span class="packing-kind ${item.required?'required':'optional'}">${item.required?'필수':'선택'}</span><span class="trip-packing-name">${escapeHtml(item.name)}</span><button class="trip-packing-custom-remove" type="button" data-delete-trip-custom-packing="${item.id}" aria-label="${escapeHtml(item.name)} 삭제">×</button></label>`).join('')}</div></section>`:'';
  list.innerHTML=moduleMarkup+customMarkup||'<div class="empty-small">준비물 선택 버튼에서 모듈을 고르거나, 이번 여행 준비물을 추가해 주세요.</div>';
  renderTripPackingPicker();
};
document.addEventListener('submit',event=>{
  if(event.target.id==='packingListForm'){
    event.preventDefault();const name=String(event.target.elements.name.value||'').trim();if(!name)return;
    if(activePackingListId){const list=packingListById(activePackingListId);if(list)list.name=name;}
    else{const list={id:uid(),name};state.packingLists.push(list);activePackingListId=list.id;}
    packingCommit('준비물 목록을 저장했어요.');renderPackingEditor(activePackingListId);return;
  }
  if(event.target.id!=='packingItemForm'||!event.target.closest('.packing-list-editor-page')||!event.defaultPrevented)return;
  const listName=String($('#packingListName')?.value||'').trim()||'나의 준비물';
  if(!activePackingListId){const list={id:uid(),name:listName};state.packingLists.push(list);activePackingListId=list.id;}
  state.packingItems.filter(item=>!item.listId).forEach(item=>{item.listId=activePackingListId;});
  commitState();
  setTimeout(()=>renderPackingEditor(activePackingListId),0);
});
document.addEventListener('click',event=>{
  const editList=event.target.closest('[data-edit-packing-list]');if(editList){routeToPackingEditor(editList.dataset.editPackingList);return;}
  const card=event.target.closest('.packing-card[data-packing-list-id]');if(card&&!event.target.closest('button'))routeToPackingEditor(card.dataset.packingListId);
});

// Keep the save action with the travel editor instead of the global header.
const headerWithoutTravelSave=header;
header=function(){
  return headerWithoutTravelSave().replace('<button class="save-trip-button" type="button" data-save-trip>여행 저장</button>','');
};

function mountTravelSaveAction(){
  const titleWrap=document.querySelector('.detail-title-wrap');
  if(!titleWrap||titleWrap.querySelector('[data-save-trip]'))return;
  const summary=titleWrap.querySelector('.trip-summary');
  const actions=document.createElement('div');
  actions.className='detail-title-actions';
  if(summary)actions.append(summary);
  actions.insertAdjacentHTML('beforeend','<button class="save-trip-button detail-save-button" type="button" data-save-trip>여행 저장</button>');
  titleWrap.append(actions);
}
const renderDetailWithTravelSaveAction=renderDetail;
renderDetail=function(){
  renderDetailWithTravelSaveAction();
  mountTravelSaveAction();
};

function packingCategoryModalMarkup(){
  return '<dialog class="trip-modal" id="packingCategoryModal"><form class="modal-box" id="packingCategoryForm"><button class="modal-close" type="button" data-close-packing-category>×</button><p class="eyebrow">PACKING CATEGORY</p><h2>준비물 카테고리</h2><p>카테고리를 추가하거나 이름을 수정할 수 있어요.</p><div class="packing-category-add"><input id="newPackingCategory" type="text" maxlength="30" placeholder="새 카테고리 이름" /><button type="button" class="small-plus" data-add-packing-category>＋</button></div><div class="packing-category-list" id="packingCategoryList"></div><div class="modal-actions"><button class="gradient-button" type="button" data-close-packing-category>완료</button></div></form></dialog>';
}
function packingFormMarkup(){
  return '<section class="detail-card packing-editor-card"><div class="detail-card-head"><div><p>PACKING LIBRARY</p><h2>준비물 항목</h2></div><span class="section-icon">＋</span></div><form id="packingItemForm" class="detail-form"><label>준비물 이름<input name="name" type="text" maxlength="60" placeholder="예: 여권, 충전기" required /></label><label>카테고리<div class="manage-row"><select name="category" id="packingItemCategory"></select><button type="button" class="small-plus" data-open-packing-categories aria-label="준비물 카테고리 관리">＋</button></div></label><fieldset class="packing-required-field"><legend>여행에 꼭 필요한가요?</legend><label><input type="radio" name="required" value="required" checked /> 필수</label><label><input type="radio" name="required" value="optional" /> 선택</label></fieldset><div class="packing-form-actions"><button class="gradient-button" type="submit" data-packing-submit>준비물 추가</button></div></form><p class="packing-editor-help">왼쪽에서 항목을 추가하거나 수정하면 오른쪽 목록에 바로 반영됩니다.</p></section>';
}
function packingListCardMarkup(){
  return '<section class="detail-card packing-library-card"><div class="detail-card-head"><div><p>MY PACKING LIST</p><h2>등록한 준비물</h2></div><strong class="packing-list-count" id="packingItemCountMirror">0개</strong></div><div class="packing-item-list" id="packingItemList"></div></section>';
}
function packingItemEditModalMarkup(){
  return '<dialog class="trip-modal packing-item-edit-modal" id="packingItemEditModal"><form class="modal-box" id="packingItemEditForm"><button class="modal-close" type="button" data-close-packing-item-edit>×</button><p class="eyebrow">PACKING ITEM</p><h2>준비물 수정</h2><p>항목 이름, 카테고리, 필수 여부만 수정할 수 있어요.</p><label>준비물 이름<input class="modal-input" name="name" type="text" maxlength="60" required /></label><label>카테고리<select class="modal-input" name="category"></select></label><fieldset class="packing-required-field"><legend>여행에 꼭 필요한가요?</legend><label><input type="radio" name="required" value="required" /> 필수</label><label><input type="radio" name="required" value="optional" /> 선택</label></fieldset><div class="modal-actions"><button class="outline-button" type="button" data-close-packing-item-edit>취소</button><button class="gradient-button" type="submit">저장</button></div></form></dialog>';
}
function openPackingItemEditModal(id){
  const item=packingItemById(id);if(!item)return;
  let modal=$('#packingItemEditModal');
  if(!modal){document.body.insertAdjacentHTML('beforeend',packingItemEditModalMarkup());modal=$('#packingItemEditModal');}
  const form=$('#packingItemEditForm');if(!form)return;
  form.dataset.editingId=item.id;form.elements.name.value=item.name;
  form.elements.category.innerHTML=state.packingCategories.map(category=>`<option value="${packingCategoryLabel(category)}">${packingCategoryLabel(category)}</option>`).join('');
  form.elements.category.value=item.category;
  form.querySelector(`input[name="required"][value="${item.required?'required':'optional'}"]`).checked=true;
  if(!modal.open)modal.showModal();
}
function renderPacking(){
  document.body.innerHTML=`<div class="trip-app">${header()}<main class="trip-list-page packing-page"><section class="list-intro"><div><p class="eyebrow">TRAVEL CHECKLIST</p><h1>준비물</h1><p>등록한 준비물을 한눈에 보고, 항목을 선택해 수정할 수 있어요.</p></div><button class="gradient-button" type="button" data-new-packing>＋ 준비물 등록</button></section><section class="trip-grid packing-grid" id="packingGrid">${state.packingItems.length?state.packingItems.map((item,index)=>`<article class="trip-card packing-card" data-packing-item-id="${item.id}"><span class="trip-card-accent"></span><div class="trip-card-top"><span class="trip-card-number">${String(index+1).padStart(2,'0')}</span><button class="trip-card-edit" type="button" data-edit-packing-item="${item.id}" aria-label="${escapeHtml(item.name)} 수정">✎</button></div><h2>${escapeHtml(item.name)}</h2><div class="trip-card-meta"><span>${packingCategoryLabel(item.category)}</span><span class="packing-kind ${item.required?'required':'optional'}">${item.required?'필수':'선택'}</span></div></article>`).join(''):'<div class="empty-page"><strong>아직 준비물이 없어요</strong>첫 준비물 항목을 등록해보세요.</div>'}</section><footer class="trip-footer">준비물 목록은 모든 여행에서 함께 사용할 수 있어요.</footer></main>${packingCategoryModalMarkup()}<div class="toast" id="toast" role="status" aria-live="polite"></div></div>`;
  mountSideNav('packing');
}
function renderPackingEditor(id){
  const item=packingItemById(id),editing=Boolean(item);
  document.body.innerHTML=`<div class="trip-app">${header()}<main class="trip-detail-page packing-editor-page"><div class="detail-topbar"><button class="back-button" type="button" data-back-packing-list>← 준비물 목록</button></div><section class="detail-title-wrap"><div><p class="eyebrow">PACKING LIBRARY</p><h1>${editing?'준비물 수정':'준비물 등록'}</h1><p>왼쪽에서 항목을 입력하고 오른쪽 목록에서 확인하세요.</p></div><span class="packing-editor-badge">${editing?'EDIT ITEM':'NEW ITEM'}</span></section><div class="packing-layout packing-editor-layout">${packingFormMarkup()}${packingListCardMarkup()}</div></main>${packingCategoryModalMarkup()}<div class="toast" id="toast" role="status" aria-live="polite"></div></div>`;
  renderPackingCategoryOptions(item?.category||state.packingCategories[0]);
  renderPackingItems();
  mountSideNav('packing');
  if(editing)beginPackingEdit(item.id);
}
document.addEventListener('click',event=>{
  const newPacking=event.target.closest('[data-new-packing]');
  if(newPacking){renderPackingEditor();return;}
  const backPacking=event.target.closest('[data-back-packing-list]');
  if(backPacking){renderPacking();return;}
  const editPacking=event.target.closest('[data-edit-packing-item]');
  if(editPacking){openPackingItemEditModal(editPacking.dataset.editPackingItem);return;}
  const card=event.target.closest('.packing-card[data-packing-item-id]');
  if(card&&!event.target.closest('button')){openPackingItemEditModal(card.dataset.packingItemId);}
});
document.addEventListener('submit',event=>{
  if(event.target.id==='packingItemEditForm'){
    event.preventDefault();const item=packingItemById(event.target.dataset.editingId),name=String(event.target.elements.name.value||'').trim();if(!item||!name)return;
    item.name=name;item.category=String(event.target.elements.category.value||state.packingCategories[0]);item.required=event.target.elements.required.value==='required';
    packingCommit('준비물 항목을 수정했어요.');$('#packingItemEditModal')?.close();if($('#packingItemList'))renderPackingItems();else if($('#packingGrid'))renderPacking();return;
  }
  if(event.target.id!=='packingItemForm'||!event.target.closest('.packing-editor-page')||!event.defaultPrevented)return;
  const listName=String($('#packingListName')?.value||'').trim()||'나의 준비물';
  if(!activePackingListId){const list={id:uid(),name:listName};state.packingLists.push(list);activePackingListId=list.id;}
  state.packingItems.filter(item=>!item.listId).forEach(item=>{item.listId=activePackingListId;});
  commitState();
  setTimeout(()=>{if(document.querySelector('.packing-editor-page'))renderPackingEditor(activePackingListId);},0);
});
