import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { 
    getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { 
    getFirestore, collection, addDoc, query, orderBy, onSnapshot, 
    serverTimestamp, setDoc, doc, getDoc, updateDoc, arrayUnion, arrayRemove, where, getDocs, deleteDoc,
    enableIndexedDbPersistence, limit 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyBw2TJjZYZZPd1piCeoFnAXhqEAcCLe1FE",
    authDomain: "chat-7e64b.firebaseapp.com",
    projectId: "chat-7e64b",
    storageBucket: "chat-7e64b.firebasestorage.app",
    messagingSenderId: "1094029259482",
    appId: "1:1094029259482:web:992007326706c5f6bd6be3",
    measurementId: "G-QMTLBH6TX0"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// ★ [최적화 1] 오프라인 지속성 활성화 (로컬 캐싱)
// 이미 받은 데이터는 로컬 IndexedDB에 저장하여 서버 읽기 횟수를 획기적으로 줄입니다.
try {
    enableIndexedDbPersistence(db).catch((err) => {
        if (err.code == 'failed-precondition') {
            console.log('여러 탭이 열려있어 오프라인 지속성이 한 탭에서만 동작합니다.');
        } else if (err.code == 'unimplemented') {
            console.log('브라우저가 오프라인 지속성을 지원하지 않습니다.');
        }
    });
} catch(e) { console.log(e); }

// ★ ImgBB API Key
const IMGBB_API_KEY = "ba55d8996626ae2a418e0374ff993157";

// 전역 상태
let currentUser = null;
let currentChatId = null;
let currentPostId = null;
let contextMenuServerId = null;
let unsubscribeMessages = null;
let unsubscribePosts = null;
let unsubscribeComments = null;
let lastMessageTime = 0;

// 유저 목록 메모리 캐싱 (탭 전환 시 재호출 방지)
let cachedUserList = null; 

const getEl = (id) => document.getElementById(id);

document.addEventListener('DOMContentLoaded', () => {
    // --- 로그인/설정 ---
    getEl('googleLoginBtn')?.addEventListener('click', handleLogin);
    getEl('settingsBtn')?.addEventListener('click', openSettings);
    getEl('closeSettingsBtn')?.addEventListener('click', () => getEl('settingsModal').style.display = 'none');
    getEl('modalLogoutBtn')?.addEventListener('click', () => { signOut(auth); getEl('settingsModal').style.display = 'none'; });

    // --- 우클릭 메뉴 ---
    document.addEventListener('click', () => getEl('serverContextMenu').style.display = 'none');
    getEl('contextLeaveServer')?.addEventListener('click', leaveServerFromContext);
    getEl('contextCopyId')?.addEventListener('click', () => {
        if(contextMenuServerId) { navigator.clipboard.writeText(contextMenuServerId); alert("ID 복사됨"); }
    });

    // --- 네비게이션 ---
    getEl('homeBtn')?.addEventListener('click', showHomeView);
    getEl('communityBtn')?.addEventListener('click', showCommunityView);

    // --- 서버/초대 ---
    getEl('addServerBtn')?.addEventListener('click', () => getEl('serverModal').style.display = 'flex');
    getEl('closeModalBtn')?.addEventListener('click', () => getEl('serverModal').style.display = 'none');
    getEl('createServerBtn')?.addEventListener('click', createServer);
    getEl('joinServerBtn')?.addEventListener('click', joinServer);
    getEl('inviteBtn')?.addEventListener('click', () => navigator.clipboard.writeText(currentChatId).then(() => alert("초대 코드 복사됨")));

    // --- 채팅/이미지 ---
    getEl('sendMsgBtn')?.addEventListener('click', sendMessage);
    getEl('messageInput')?.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendMessage(); });
    getEl('messageInput')?.addEventListener('paste', handlePasteUpload);
    getEl('attachBtn')?.addEventListener('click', () => getEl('imageInput').click());
    getEl('imageInput')?.addEventListener('change', (e) => { if(e.target.files[0]) processAndUploadImage(e.target.files[0]); });

    // --- 커뮤니티 ---
    getEl('writePostBtn')?.addEventListener('click', showWriteForm);
    getEl('cancelPostBtn')?.addEventListener('click', () => { getEl('postWriteSection').style.display = 'none'; getEl('postListSection').style.display = 'flex'; });
    getEl('submitPostBtn')?.addEventListener('click', submitPost);
    getEl('backToListBtn')?.addEventListener('click', showCommunityView);
    getEl('submitCommentBtn')?.addEventListener('click', submitComment);

    getEl('userSearchInput')?.addEventListener('input', handleSearch);
});

// === 로그인 및 초기화 ===
async function handleLogin() {
    try { await signInWithPopup(auth, new GoogleAuthProvider()); } catch (e) { alert("로그인 오류"); }
}

onAuthStateChanged(auth, async (user) => {
    if (user) {
        let displayName = user.displayName;
        if (user.email === 'yudongyun08@gmail.com') displayName = "관리자";
        currentUser = { ...user, displayName }; 

        getEl('loginOverlay').style.display = 'none';
        getEl('myAvatar').src = user.photoURL;
        getEl('myName').textContent = displayName;
        
        // ★ [최적화] 불필요한 쓰기 방지를 위해 마지막 로그인 시간 등은 필요한 경우에만 업데이트 하거나
        // 여기서는 유지하되, 전체적인 읽기 최적화에 집중합니다.
        await setDoc(doc(db, "users", user.uid), {
            uid: user.uid, displayName, email: user.email, photoURL: user.photoURL, lastLogin: serverTimestamp()
        }, { merge: true });

        loadMyServers();
        renderRecentDMs();
        showHomeView();
    } else {
        currentUser = null;
        cachedUserList = null; // 로그아웃 시 캐시 초기화
        getEl('loginOverlay').style.display = 'flex';
    }
});

function openSettings() {
    if(!currentUser) return;
    getEl('settingAvatar').src = currentUser.photoURL;
    getEl('settingName').textContent = currentUser.displayName;
    getEl('settingEmail').textContent = currentUser.email;
    getEl('settingsModal').style.display = 'flex';
}

// === 화면 전환 ===
function resetActiveIcons() {
    document.querySelectorAll('.server-icon').forEach(el => el.classList.remove('active'));
}

function showHomeView() {
    resetActiveIcons();
    getEl('homeBtn').classList.add('active');
    getEl('homeView').style.display = 'flex';
    getEl('chatView').style.display = 'none';
    getEl('communityView').style.display = 'none';
    getEl('mainHeaderTitle').textContent = "홈";
    getEl('mainHeaderIcon').className = "fas fa-home";
    getEl('sidebarTitle').textContent = "대화";
    getEl('inviteBtn').style.display = 'none';
    
    // 리스너 정리 (채팅방, 게시판에서 나왔으므로)
    if(unsubscribeMessages) { unsubscribeMessages(); unsubscribeMessages = null; }
    if(unsubscribePosts) { unsubscribePosts(); unsubscribePosts = null; }

    renderRecentDMs();
    loadAllUsers();
}

function showCommunityView() {
    resetActiveIcons();
    getEl('communityBtn').classList.add('active');
    getEl('homeView').style.display = 'none';
    getEl('chatView').style.display = 'none';
    getEl('communityView').style.display = 'flex';
    
    // 채팅 리스너 해제
    if(unsubscribeMessages) { unsubscribeMessages(); unsubscribeMessages = null; }
    
    // 커뮤니티 초기화
    getEl('postListSection').style.display = 'flex';
    getEl('postWriteSection').style.display = 'none';
    getEl('postDetailSection').style.display = 'none';
    
    getEl('mainHeaderTitle').textContent = "자유게시판";
    getEl('mainHeaderIcon').className = "fas fa-globe";
    getEl('sidebarTitle').textContent = "커뮤니티";
    getEl('inviteBtn').style.display = 'none';
    
    getEl('sidebarContent').innerHTML = `<div class="channel-category">게시판</div><div class="dm-item active"><i class="fas fa-list"></i> 자유게시판</div>`;
    loadCommunityPosts();
}

// === 서버 로직 ===
function loadMyServers() {
    if (!currentUser) return;
    const q = query(collection(db, "servers"), where("members", "array-contains", currentUser.uid));
    onSnapshot(q, (snapshot) => {
        const container = getEl('serverListContainer');
        container.innerHTML = '';
        snapshot.forEach((docSnap) => {
            const server = docSnap.data();
            const div = document.createElement('div');
            div.className = 'server-icon';
            div.textContent = server.name.substring(0, 1);
            div.onclick = (e) => {
                resetActiveIcons();
                e.target.classList.add('active');
                enterServerChat(docSnap.id, server.name);
            };
            div.oncontextmenu = (e) => {
                e.preventDefault();
                contextMenuServerId = docSnap.id;
                const menu = getEl('serverContextMenu');
                menu.style.display = 'block';
                menu.style.left = `${e.pageX}px`;
                menu.style.top = `${e.pageY}px`;
            };
            container.appendChild(div);
        });
    });
}

function enterServerChat(serverId, serverName) {
    currentChatId = serverId;
    getEl('homeView').style.display = 'none';
    getEl('communityView').style.display = 'none';
    getEl('chatView').style.display = 'flex';
    getEl('mainHeaderTitle').textContent = serverName;
    getEl('mainHeaderIcon').className = "fas fa-users";
    getEl('sidebarTitle').textContent = serverName;
    getEl('inviteBtn').style.display = 'block';
    getEl('sidebarContent').innerHTML = `<div class="channel-category">채널</div><div class="dm-item active"><i class="fas fa-hashtag"></i> 일반</div>`;
    
    // 게시판 리스너 해제
    if(unsubscribePosts) { unsubscribePosts(); unsubscribePosts = null; }
    
    loadMessages(serverId);
}

async function leaveServerFromContext() {
    if (!contextMenuServerId || !currentUser) return;
    if (!confirm("서버에서 나가시겠습니까?")) return;
    try {
        await updateDoc(doc(db, "servers", contextMenuServerId), { members: arrayRemove(currentUser.uid) });
        if(currentChatId === contextMenuServerId) showHomeView();
        alert("나갔습니다.");
    } catch (e) { alert("오류"); }
}

async function createServer() {
    const name = getEl('newServerName').value.trim();
    if (!name) return;
    await addDoc(collection(db, "servers"), { name, owner: currentUser.uid, members: [currentUser.uid], createdAt: serverTimestamp() });
    getEl('serverModal').style.display = 'none';
}
async function joinServer() {
    const id = getEl('joinServerCode').value.trim();
    if (!id) return;
    const ref = doc(db, "servers", id);
    const snap = await getDoc(ref);
    if(snap.exists()) { await updateDoc(ref, { members: arrayUnion(currentUser.uid) }); getEl('serverModal').style.display = 'none'; }
}

// === 채팅 & 이미지 ===
function handlePasteUpload(e) {
    const items = (e.clipboardData || e.originalEvent.clipboardData).items;
    for (let index in items) {
        const item = items[index];
        if (item.kind === 'file' && item.type.includes('image')) {
            processAndUploadImage(item.getAsFile());
            e.preventDefault();
            return;
        }
    }
}

async function processAndUploadImage(file) {
    if (!currentUser || !currentChatId) return;
    const sendBtn = getEl('sendMsgBtn');
    const org = sendBtn.innerHTML;
    sendBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>'; sendBtn.disabled = true;
    try {
        const url = await uploadToImgBB(file);
        if(url) await sendMessage(null, url);
    } catch(e) { console.log(e); }
    sendBtn.innerHTML = org; sendBtn.disabled = false;
    getEl('imageInput').value = '';
}

async function uploadToImgBB(file) {
    const formData = new FormData(); formData.append("image", file);
    const res = await fetch(`https://api.imgbb.com/1/upload?key=${IMGBB_API_KEY}&expiration=86400`, { method: "POST", body: formData });
    const data = await res.json();
    return data.success ? data.data.url : null;
}

// [수정] 쿨타임(5초) 및 글자수 제한 적용
async function sendMessage(textOverride=null, imageUrl=null) {
    const input = getEl('messageInput');
    const text = textOverride !== null ? textOverride : input.value.trim();

    // 1. 내용 없음 체크
    if ((!text && !imageUrl) || !currentChatId) return;

    // 2. 글자 수 제한 체크 (HTML maxlength가 뚫릴 경우 대비)
    if (text.length > 200) {
        alert("메시지는 200자를 넘을 수 없습니다.");
        return;
    }

    // 3. 쿨타임 체크 (5초 = 5000ms)
    const now = Date.now();
    if (now - lastMessageTime < 5000) {
        alert("채팅 도배 방지: 5초 뒤에 보낼 수 있습니다.");
        return;
    }

    // 메시지 전송
    try {
        await addDoc(collection(db, "chats", currentChatId, "messages"), {
            text: text || "", 
            imageUrl: imageUrl || null, 
            uid: currentUser.uid, 
            displayName: currentUser.displayName, 
            photoURL: currentUser.photoURL, 
            createdAt: serverTimestamp()
        });
        
        lastMessageTime = Date.now(); // 전송 성공 시 시간 갱신
        if(!imageUrl) input.value = '';
    } catch (e) {
        console.error("전송 실패:", e);
    }
}

// [수정] loadMessages 내부의 DOM 생성 로직 변경
function loadMessages(chatId) {
    if (unsubscribeMessages) unsubscribeMessages();
    const container = getEl('messagesContainer');
    container.innerHTML = ''; 

    const q = query(collection(db, "chats", chatId, "messages"), orderBy("createdAt", "asc"), limit(75));
    
    unsubscribeMessages = onSnapshot(q, (snapshot) => {
        snapshot.docChanges().forEach((change) => {
            if (change.type === "added") {
                const msg = change.doc.data();
                const isMe = msg.uid === currentUser.uid;
                
                // [추가] 시간 포맷팅 (DB에 데이터가 있으면 변환, 방금 보낸건 현재시간)
                let timeStr = "";
                if (msg.createdAt) {
                    const date = msg.createdAt.toDate ? msg.createdAt.toDate() : new Date();
                    timeStr = date.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
                }

                // [추가] 알림 기능: 내가 보낸 게 아니고, 현재 창이 포커스가 아닐 때 제목 변경
                if (!isMe && document.hidden) {
                    document.title = "🔴 새 메시지!";
                } else {
                    document.title = "Chat App";
                }

                let contentHtml = '';
                if(msg.imageUrl) contentHtml += `<img src="${msg.imageUrl}" class="chat-image" onclick="window.open(this.src)">`;
                if(msg.text) contentHtml += `<div>${msg.text}</div>`;
                
                const wrapper = document.createElement('div');
                wrapper.className = `message-wrapper ${isMe?'me':'other'}`;
                
                // [수정] HTML 구조에 msg-time 추가
                // 내가 보낸 메시지는 flex order로 인해 시간이 왼쪽, 상대방은 오른쪽에 뜸
                wrapper.innerHTML = isMe 
                    ? `<span class="msg-time">${timeStr}</span><div class="bubble">${contentHtml}</div>` 
                    : `<img src="${msg.photoURL}" class="avatar">
                       <div class="bubble-group">
                           <span class="meta">${msg.displayName}</span>
                           <div style="display:flex; align-items:flex-end;">
                               <div class="bubble">${contentHtml}</div>
                               <span class="msg-time">${timeStr}</span>
                           </div>
                       </div>`;
                
                container.appendChild(wrapper);
            }
        });
        container.scrollTop = container.scrollHeight;
    });
}

// === 커뮤니티 ===
function loadCommunityPosts() {
    if (unsubscribePosts) unsubscribePosts();
    const container = getEl('postsContainer');
    // ★ [최적화] 게시판도 최근 50개만 불러오기
    const q = query(collection(db, "posts"), orderBy("createdAt", "desc"), limit(50));
    
    unsubscribePosts = onSnapshot(q, (snapshot) => {
        container.innerHTML = '';
        if(snapshot.empty) container.innerHTML = '<div style="color:#72767d; text-align:center;">작성된 글이 없습니다.</div>';
        snapshot.forEach(docSnap => {
            const p = docSnap.data();
            const date = p.createdAt ? new Date(p.createdAt.seconds*1000).toLocaleDateString() : '';
            const div = document.createElement('div');
            div.className = 'post-item';
            div.innerHTML = `<h3>${p.title}</h3><div class="post-info"><span>${p.authorName}</span> • <span>${date}</span></div>`;
            div.onclick = () => showPostDetail(docSnap.id, p);
            container.appendChild(div);
        });
    });
}
function showWriteForm() { getEl('postListSection').style.display = 'none'; getEl('postWriteSection').style.display = 'flex'; getEl('postTitleInput').value=''; getEl('postContentInput').value=''; }
async function submitPost() {
    const title = getEl('postTitleInput').value.trim(); const content = getEl('postContentInput').value.trim();
    if(!title||!content) return;
    await addDoc(collection(db, "posts"), { title, content, authorUid: currentUser.uid, authorName: currentUser.displayName, createdAt: serverTimestamp() });
    showCommunityView();
}
function showPostDetail(pid, pdata) {
    currentPostId = pid;
    getEl('postListSection').style.display='none'; getEl('postDetailSection').style.display='flex';
    getEl('detailTitle').textContent = pdata.title; getEl('detailAuthor').textContent = pdata.authorName;
    getEl('detailContent').textContent = pdata.content; getEl('detailDate').textContent = pdata.createdAt?new Date(pdata.createdAt.seconds*1000).toLocaleString():'';
    loadComments(pid);
}
function loadComments(pid) {
    if(unsubscribeComments) unsubscribeComments();
    const container = getEl('commentsContainer');
    // 댓글은 보통 양이 적지만, 그래도 안전하게 limit
    const q = query(collection(db, "posts", pid, "comments"), orderBy("createdAt", "asc"), limit(100));
    unsubscribeComments = onSnapshot(q, (snapshot) => {
        container.innerHTML = '';
        snapshot.forEach(doc => {
            const c = doc.data();
            const div = document.createElement('div');
            div.className = 'comment-item';
            div.innerHTML = `<div class="comment-header">${c.authorName}</div><div>${c.text}</div>`;
            container.appendChild(div);
        });
    });
}
async function submitComment() {
    const text = getEl('commentInput').value.trim();
    if(!text || !currentPostId) return;
    await addDoc(collection(db, "posts", currentPostId, "comments"), { text, authorName: currentUser.displayName, uid: currentUser.uid, createdAt: serverTimestamp() });
    getEl('commentInput').value = '';
}

// === DM & 유저 ===
function startDM(targetUser) {
    addToRecentDMs(targetUser);
    const uids = [currentUser.uid, targetUser.uid].sort();
    const dmId = `dm_${uids[0]}_${uids[1]}`;
    resetActiveIcons();
    getEl('homeBtn').classList.add('active');
    getEl('homeView').style.display = 'none'; getEl('communityView').style.display = 'none'; getEl('chatView').style.display = 'flex';
    currentChatId = dmId;
    getEl('mainHeaderTitle').textContent = targetUser.displayName; getEl('mainHeaderIcon').className = "fas fa-user"; getEl('inviteBtn').style.display = 'none';
    
    if(unsubscribePosts) { unsubscribePosts(); unsubscribePosts = null; }
    
    renderRecentDMs(); loadMessages(dmId);
}
function addToRecentDMs(user) {
    let list = JSON.parse(localStorage.getItem(`recent_dms_${currentUser.uid}`) || "[]");
    list = list.filter(u => u.uid !== user.uid);
    list.unshift({ uid: user.uid, displayName: user.displayName, photoURL: user.photoURL });
    if(list.length > 5) list = list.slice(0, 5);
    localStorage.setItem(`recent_dms_${currentUser.uid}`, JSON.stringify(list));
}
function renderRecentDMs() {
    if(getEl('sidebarTitle').textContent !== "대화") return;
    const list = JSON.parse(localStorage.getItem(`recent_dms_${currentUser.uid}`) || "[]");
    const container = getEl('sidebarContent');
    let html = `<div class="channel-category">최근 대화</div>`;
    list.forEach(u => {
        const uids = [currentUser.uid, u.uid].sort();
        const isActive = (currentChatId === `dm_${uids[0]}_${uids[1]}`);
        html += `<div class="dm-item ${isActive?'active':''}" id="dm_item_${u.uid}"><img src="${u.photoURL}"><span class="name">${u.displayName}</span></div>`;
    });
    container.innerHTML = html;
    list.forEach(u => getEl(`dm_item_${u.uid}`).onclick = () => startDM(u));
}

// ★ [최적화 3] 유저 목록 메모리 캐싱 (탭 이동 시 재호출 방지)
async function loadAllUsers() {
    const container = getEl('userListContainer');
    
    // 캐시된 데이터가 있다면 바로 사용 (읽기 0회)
    if (cachedUserList) {
        renderUserList(cachedUserList);
        return;
    }

    const q = query(collection(db, "users"));
    const snapshot = await getDocs(q);
    
    // 데이터 캐싱
    cachedUserList = [];
    snapshot.forEach(doc => cachedUserList.push(doc.data()));
    
    renderUserList(cachedUserList);
}

function renderUserList(users) {
    const container = getEl('userListContainer');
    container.innerHTML = '';
    let count = 0;
    users.forEach(user => {
        if(user.uid === currentUser.uid) return;
        count++;
        const div = document.createElement('div');
        div.className = 'user-card';
        div.innerHTML = `<img src="${user.photoURL}"><div><h4>${user.displayName}</h4></div>`;
        div.onclick = () => startDM(user);
        container.appendChild(div);
    });
    getEl('userCount').textContent = count;
}

function handleSearch(e) {
    const term = e.target.value.toLowerCase();
    document.querySelectorAll('.user-card').forEach(card => card.style.display = card.innerText.toLowerCase().includes(term) ? 'flex' : 'none');
}
