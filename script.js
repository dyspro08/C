import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { 
    getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { 
    getFirestore, collection, addDoc, query, orderBy, onSnapshot, 
    serverTimestamp, setDoc, doc, getDoc, updateDoc, arrayUnion, arrayRemove, where, getDocs, deleteDoc,
    enableIndexedDbPersistence, limit, writeBatch
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

// 오프라인 지속성
try { enableIndexedDbPersistence(db).catch(() => {}); } catch(e) {}

// ★ ImgBB API Key
const IMGBB_API_KEY = "ba55d8996626ae2a418e0374ff993157";

// 전역 상태
let currentUser = null;
let currentChatId = null;
let currentPostId = null;
let contextMenuServerId = null;

// 리스너 변수들
let unsubscribeMessages = null;
let unsubscribePosts = null;
let unsubscribeComments = null;
let unsubscribeChatList = null; // [NEW] 채팅방 목록 감시용

// 유저 목록 캐싱
let cachedUserList = null; 
// [NEW] 쿨타임 관리
let lastMessageTime = 0; 

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
    getEl('sendMsgBtn')?.addEventListener('click', () => sendMessage()); // 인자 전달 문제 해결을 위해 래퍼 함수 사용
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

    // 탭 복귀 시 제목 초기화
    document.addEventListener("visibilitychange", () => {
        if (!document.hidden) document.title = "Chat App";
    });
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
        
        await setDoc(doc(db, "users", user.uid), {
            uid: user.uid, displayName, email: user.email, photoURL: user.photoURL, lastLogin: serverTimestamp()
        }, { merge: true });

        loadMyServers();
        loadRecentChats(); // [NEW] 실시간 채팅방 목록 로드
        showHomeView();
    } else {
        currentUser = null;
        cachedUserList = null;
        getEl('loginOverlay').style.display = 'flex';
        if(unsubscribeChatList) unsubscribeChatList(); // 로그아웃 시 리스너 해제
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
    
    currentChatId = null; // 채팅방 나감 처리

    if(unsubscribeMessages) { unsubscribeMessages(); unsubscribeMessages = null; }
    if(unsubscribePosts) { unsubscribePosts(); unsubscribePosts = null; }

    loadAllUsers();
}

function showCommunityView() {
    resetActiveIcons();
    getEl('communityBtn').classList.add('active');
    getEl('homeView').style.display = 'none';
    getEl('chatView').style.display = 'none';
    getEl('communityView').style.display = 'flex';
    
    currentChatId = null;

    if(unsubscribeMessages) { unsubscribeMessages(); unsubscribeMessages = null; }
    
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

async function createServer() {
    const name = getEl('newServerName').value.trim();
    if (!name) return;
    // 서버 생성 시 채팅방 메타데이터도 같이 생성 (간소화)
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

// === [NEW] 실시간 채팅방 목록 (빨간 점 구현의 핵심) ===
function loadRecentChats() {
    if (!currentUser) return;
    if (unsubscribeChatList) unsubscribeChatList();

    const container = getEl('sidebarContent');
    // 'chats' 컬렉션 중 내가 멤버('members')로 포함된 방을 찾음
    // 주의: servers에 있는 채팅방도 로직 통일을 위해 chats/{serverId} 문서가 필요할 수 있음
    // 여기서는 DM 위주로 처리하고, 서버 채팅은 목록에 따로 뜨지 않으므로 패스
    
    // DM 채팅방은 members 필드를 가지고 있어야 함.
    const q = query(collection(db, "chats"), where("members", "array-contains", currentUser.uid), orderBy("lastMessageTime", "desc"));

    unsubscribeChatList = onSnapshot(q, (snapshot) => {
        // 사이드바 타이틀이 '대화'일 때만 렌더링
        if(getEl('sidebarTitle').textContent !== "대화") return;

        let html = `<div class="channel-category">최근 대화</div>`;
        
        snapshot.forEach(docSnap => {
            const data = docSnap.data();
            const chatId = docSnap.id;
            
            // 상대방 정보 찾기 (1:1 DM 가정)
            let otherUser = { displayName: "알 수 없음", photoURL: "" };
            if (data.participantData) {
                // 내 UID가 아닌 다른 사람의 키를 찾음
                const otherUid = Object.keys(data.participantData).find(uid => uid !== currentUser.uid);
                if(otherUid) otherUser = data.participantData[otherUid];
            } else {
                // 데이터가 없으면 기존 방식(ID 파싱) 시도
                return; // 마이그레이션 안된 데이터는 스킵
            }

            // [핵심] 읽지 않음 판별
            // lastMessageTime(마지막 대화 시간) > lastRead_{내UID} (내가 읽은 시간)
            const lastMsgTime = data.lastMessageTime?.toDate()?.getTime() || 0;
            const myReadTime = data[`lastRead_${currentUser.uid}`]?.toDate()?.getTime() || 0;
            const hasUnread = lastMsgTime > myReadTime;
            
            const isActive = (currentChatId === chatId);
            
            html += `
            <div class="dm-item ${isActive?'active':''} ${hasUnread?'has-unread':''}" id="chat_item_${chatId}">
                <img src="${otherUser.photoURL || 'https://via.placeholder.com/32'}">
                <span class="name">${otherUser.displayName}</span>
                ${hasUnread ? '<span class="unread-dot"></span>' : ''}
            </div>`;
        });
        
        container.innerHTML = html;

        // 클릭 이벤트 연결
        snapshot.forEach(docSnap => {
            const chatId = docSnap.id;
            const data = docSnap.data();
             // 상대방 찾기 로직 동일
            let otherUser = null;
            if (data.participantData) {
                const otherUid = Object.keys(data.participantData).find(uid => uid !== currentUser.uid);
                if(otherUid) otherUser = { uid: otherUid, ...data.participantData[otherUid] };
            }

            if(getEl(`chat_item_${chatId}`)) {
                getEl(`chat_item_${chatId}`).onclick = () => {
                    if(otherUser) startDM(otherUser);
                    else enterServerChat(chatId, "채팅방"); // Fallback
                };
            }
        });
    });
}

// === 채팅 진입 및 읽음 처리 ===

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
    
    if(unsubscribePosts) { unsubscribePosts(); unsubscribePosts = null; }
    
    loadMessages(serverId);
    markAsRead(serverId); // [NEW] 들어왔으니 읽음 처리
}

async function startDM(targetUser) {
    // DM ID 생성
    const uids = [currentUser.uid, targetUser.uid].sort();
    const dmId = `dm_${uids[0]}_${uids[1]}`;
    
    // [NEW] 채팅방 문서가 없으면 생성 (메타데이터 저장)
    const chatRef = doc(db, "chats", dmId);
    const chatSnap = await getDoc(chatRef);
    
    if (!chatSnap.exists()) {
        await setDoc(chatRef, {
            members: uids,
            participantData: {
                [currentUser.uid]: { displayName: currentUser.displayName, photoURL: currentUser.photoURL },
                [targetUser.uid]: { displayName: targetUser.displayName, photoURL: targetUser.photoURL }
            },
            createdAt: serverTimestamp(),
            lastMessageTime: serverTimestamp(),
            [`lastRead_${currentUser.uid}`]: serverTimestamp(),
            [`lastRead_${targetUser.uid}`]: serverTimestamp()
        });
    }

    resetActiveIcons();
    getEl('homeBtn').classList.add('active');
    getEl('homeView').style.display = 'none'; 
    getEl('communityView').style.display = 'none'; 
    getEl('chatView').style.display = 'flex';
    
    currentChatId = dmId;
    getEl('mainHeaderTitle').textContent = targetUser.displayName; 
    getEl('mainHeaderIcon').className = "fas fa-user"; 
    getEl('inviteBtn').style.display = 'none';
    
    if(unsubscribePosts) { unsubscribePosts(); unsubscribePosts = null; }
    
    loadMessages(dmId);
    markAsRead(dmId); // [NEW] 읽음 처리
}

// [NEW] 읽음 처리 함수
async function markAsRead(chatId) {
    if(!currentUser || !chatId) return;
    const chatRef = doc(db, "chats", chatId);
    // 내 lastRead 시간을 현재로 업데이트
    await updateDoc(chatRef, {
        [`lastRead_${currentUser.uid}`]: serverTimestamp()
    });
}

// === 메시지 전송 (Batch Update) ===
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

// [NEW] 메시지 전송 로직 대폭 수정 (Batch 사용)
async function sendMessage(textOverride=null, imageUrl=null) {
    const input = getEl('messageInput');
    const text = textOverride !== null ? textOverride : input.value.trim();

    if ((!text && !imageUrl) || !currentChatId) return;
    if (text.length > 200) { alert("200자 제한"); return; }
    
    const now = Date.now();
    if (now - lastMessageTime < 5000) { alert("도배 방지: 5초 대기"); return; }
    lastMessageTime = now;

    const messageData = {
        text: text || "", imageUrl: imageUrl || null, 
        uid: currentUser.uid, displayName: currentUser.displayName, photoURL: currentUser.photoURL, 
        createdAt: serverTimestamp()
    };

    try {
        const batch = writeBatch(db);
        
        // 1. 메시지 컬렉션에 추가
        const msgRef = doc(collection(db, "chats", currentChatId, "messages"));
        batch.set(msgRef, messageData);

        // 2. 채팅방 메타데이터(시간, 읽음상태) 업데이트
        // 나는 방금 보냈으니 읽은 상태, 상대방은 안 읽은 상태가 됨 (상대방 lastRead는 건드리지 않으므로)
        const chatRef = doc(db, "chats", currentChatId);
        
        // 채팅방 정보가 없을 수 있으니 set(merge) 사용
        batch.set(chatRef, {
            lastMessageTime: serverTimestamp(), // 전체 방의 최신 시간 갱신
            recentMessage: text || "(이미지)",   // (옵션) 목록에 미리보기 띄우려면 사용
            [`lastRead_${currentUser.uid}`]: serverTimestamp(), // 나는 읽음 처리
            // members 정보도 혹시 모르니 업데이트
            members: arrayUnion(currentUser.uid)
        }, { merge: true });

        await batch.commit();

        if(!imageUrl) input.value = '';
    } catch (e) {
        console.error("전송 실패:", e);
    }
}

// === 메시지 로드 ===
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
                
                let timeStr = "";
                if (msg.createdAt) {
                    const date = msg.createdAt.toDate ? msg.createdAt.toDate() : new Date();
                    timeStr = date.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
                }

                // [NEW] 탭이 비활성화 되어있고 상대방 메시지면 알림
                if (!isMe && document.hidden) document.title = "🔴 새 메시지!";

                // 내가 메시지를 받고 있고, 채팅창을 보고 있다면 '읽음' 갱신
                if (!document.hidden && currentChatId === chatId) {
                   // 너무 자주 갱신하면 안 좋으므로, 필요 시 디바운스(Debounce) 적용 가능
                   // 여기서는 간단하게 생략하거나, 메시지 받을 때마다 갱신 (비용 조금 듦)
                   markAsRead(chatId);
                }

                let contentHtml = '';
                if(msg.imageUrl) contentHtml += `<img src="${msg.imageUrl}" class="chat-image" onclick="window.open(this.src)">`;
                if(msg.text) contentHtml += `<div>${msg.text}</div>`;
                
                const wrapper = document.createElement('div');
                wrapper.className = `message-wrapper ${isMe?'me':'other'}`;
                
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

// === 유저 목록 캐싱 ===
async function loadAllUsers() {
    const container = getEl('userListContainer');
    if (cachedUserList) { renderUserList(cachedUserList); return; }
    const q = query(collection(db, "users"));
    const snapshot = await getDocs(q);
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
