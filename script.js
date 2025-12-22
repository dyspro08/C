import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { 
    getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { 
    getFirestore, collection, addDoc, query, orderBy, onSnapshot, 
    serverTimestamp, setDoc, doc, getDoc, updateDoc, arrayUnion, arrayRemove, where, getDocs, deleteDoc,
    enableIndexedDbPersistence, limit, writeBatch
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// === 설정 ===
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
try { enableIndexedDbPersistence(db).catch(() => {}); } catch(e) {}

const IMGBB_API_KEY = "ba55d8996626ae2a418e0374ff993157";

// === 전역 변수 ===
let currentUser = null;
let currentChatId = null;
let currentPostId = null;
let contextMenuServerId = null;

// 리스너 해제용 변수
let unsubscribeMessages = null;
let unsubscribePosts = null;
let unsubscribeComments = null;
let unsubscribeChatList = null; 
let unsubscribeServerList = null; 

let cachedUserList = []; // [중요] 초기값 빈 배열로 설정
let lastMessageTime = 0; 

const getEl = (id) => document.getElementById(id);

// === [추가] 윈도우 포커스 감지 (제목 초기화) ===
window.addEventListener('focus', () => {
    document.title = "Chat App"; 
    if (currentChatId) {
        // 창으로 돌아왔을 때 현재 방 읽음 처리
        const isServer = !currentChatId.startsWith("dm_");
        markAsRead(currentChatId, isServer);
    }
});

// === 초기화 ===
document.addEventListener('DOMContentLoaded', () => {
    getEl('googleLoginBtn')?.addEventListener('click', handleLogin);
    getEl('settingsBtn')?.addEventListener('click', openSettings);
    getEl('closeSettingsBtn')?.addEventListener('click', () => getEl('settingsModal').style.display = 'none');
    getEl('modalLogoutBtn')?.addEventListener('click', () => { signOut(auth); getEl('settingsModal').style.display = 'none'; });

    document.addEventListener('click', () => {
        getEl('serverContextMenu').style.display = 'none';
        document.title = "Chat App"; 
    });
    
    getEl('contextLeaveServer')?.addEventListener('click', () => leaveServerFromContext());
    getEl('contextCopyId')?.addEventListener('click', () => {
        if(contextMenuServerId) { navigator.clipboard.writeText(contextMenuServerId); alert("ID 복사됨"); }
    });

    getEl('homeBtn')?.addEventListener('click', showHomeView);
    getEl('communityBtn')?.addEventListener('click', showCommunityView);

    getEl('addServerBtn')?.addEventListener('click', () => getEl('serverModal').style.display = 'flex');
    getEl('closeModalBtn')?.addEventListener('click', () => getEl('serverModal').style.display = 'none');
    getEl('createServerBtn')?.addEventListener('click', createServer);
    getEl('joinServerBtn')?.addEventListener('click', joinServer);
    getEl('inviteBtn')?.addEventListener('click', () => navigator.clipboard.writeText(currentChatId).then(() => alert("초대 코드 복사됨"));

    getEl('sendMsgBtn')?.addEventListener('click', () => sendMessage());
    getEl('messageInput')?.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendMessage(); });
    getEl('messageInput')?.addEventListener('paste', handlePasteUpload);
    getEl('attachBtn')?.addEventListener('click', () => getEl('imageInput').click());
    getEl('imageInput')?.addEventListener('change', (e) => { if(e.target.files[0]) processAndUploadImage(e.target.files[0]); });

    getEl('writePostBtn')?.addEventListener('click', showWriteForm);
    getEl('cancelPostBtn')?.addEventListener('click', () => { getEl('postWriteSection').style.display = 'none'; getEl('postListSection').style.display = 'flex'; });
    getEl('submitPostBtn')?.addEventListener('click', submitPost);
    getEl('backToListBtn')?.addEventListener('click', showCommunityView);
    getEl('submitCommentBtn')?.addEventListener('click', submitComment);
    getEl('userSearchInput')?.addEventListener('input', handleSearch);
});

// === 인증 ===
async function handleLogin() {
    try { await signInWithPopup(auth, new GoogleAuthProvider()); } catch (e) { alert("로그인 오류: " + e.message); }
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

        // [중요] 유저 목록을 먼저 불러와야 "알 수 없음"을 방지할 수 있음
        await loadAllUsers();
        loadMyServers(); 
        showHomeView(); 
    } else {
        currentUser = null;
        cachedUserList = [];
        getEl('loginOverlay').style.display = 'flex';
        if(unsubscribeChatList) unsubscribeChatList();
        if(unsubscribeServerList) unsubscribeServerList();
        if(unsubscribeMessages) unsubscribeMessages();
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
    document.querySelectorAll('.dm-item').forEach(el => el.classList.remove('active'));
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
    
    currentChatId = null;
    document.title = "Chat App"; 

    if(unsubscribeMessages) { unsubscribeMessages(); unsubscribeMessages = null; }
    if(unsubscribePosts) { unsubscribePosts(); unsubscribePosts = null; }
    
    getEl('sidebarContent').innerHTML = '<div class="channel-category">로딩 중...</div>';
    loadRecentChats(); 
    // loadAllUsers(); // 위에서 이미 호출함
}

function showCommunityView() {
    resetActiveIcons();
    getEl('communityBtn').classList.add('active');
    getEl('homeView').style.display = 'none';
    getEl('chatView').style.display = 'none';
    getEl('communityView').style.display = 'flex';
    
    currentChatId = null;
    document.title = "Chat App";

    if(unsubscribeMessages) { unsubscribeMessages(); unsubscribeMessages = null; }
    if(unsubscribeChatList) { unsubscribeChatList(); unsubscribeChatList = null; }
    
    getEl('postListSection').style.display = 'flex';
    getEl('postWriteSection').style.display = 'none';
    getEl('postDetailSection').style.display = 'none';
    
    getEl('mainHeaderTitle').textContent = "자유게시판";
    getEl('sidebarTitle').textContent = "커뮤니티";
    getEl('inviteBtn').style.display = 'none';
    
    getEl('sidebarContent').innerHTML = `<div class="channel-category">게시판</div><div class="dm-item active"><i class="fas fa-list"></i> 자유게시판</div>`;
    loadCommunityPosts();
}

// === 서버 목록 ===
function loadMyServers() {
    if (!currentUser) return;
    if (unsubscribeServerList) unsubscribeServerList();

    const q = query(collection(db, "servers"), where("members", "array-contains", currentUser.uid));
    unsubscribeServerList = onSnapshot(q, (snapshot) => {
        const container = getEl('serverListContainer');
        container.innerHTML = '';
        
        snapshot.forEach((docSnap) => {
            const server = docSnap.data();
            const div = document.createElement('div');
            div.className = 'server-icon';
            div.textContent = server.name.substring(0, 1);
            div.id = `server_icon_${docSnap.id}`; 
            
            const lastMsgTime = server.lastMessageTime?.toDate()?.getTime() || 0;
            const myReadTime = server[`lastRead_${currentUser.uid}`]?.toDate()?.getTime() || 0;
            const lastSender = server.lastMessageSenderId || ""; 

            const isUnread = (lastMsgTime > myReadTime) && (lastSender !== currentUser.uid);
            const isCurrentlyViewing = (currentChatId === docSnap.id);

            if (isUnread && !isCurrentlyViewing) {
                const badge = document.createElement('span');
                badge.className = 'unread-badge'; 
                div.appendChild(badge);
            }

            if (isCurrentlyViewing) div.classList.add('active');

            div.onclick = (e) => {
                resetActiveIcons();
                div.classList.add('active');
                const existingBadge = div.querySelector('.unread-badge');
                if(existingBadge) existingBadge.remove();
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

// === [핵심 수정] 최근 대화 목록 ("알 수 없음" 해결 + 뱃지) ===
function loadRecentChats() {
    if (!currentUser) return;
    if (unsubscribeChatList) unsubscribeChatList();

    const container = getEl('sidebarContent');
    const q = query(collection(db, "chats"), where("members", "array-contains", currentUser.uid), orderBy("lastMessageTime", "desc"));

    unsubscribeChatList = onSnapshot(q, (snapshot) => {
        if(getEl('sidebarTitle').textContent !== "대화") return;

        let html = `<div class="channel-category">최근 대화</div>`;
        
        snapshot.forEach(docSnap => {
            const data = docSnap.data();
            const chatId = docSnap.id;
            
            // 1. 상대방 UID 찾기 (나를 제외한 첫 번째 사람)
            let otherUid = data.members ? data.members.find(uid => uid !== currentUser.uid) : null;
            if (!otherUid && data.members && data.members.length > 0) otherUid = currentUser.uid; // 나 자신과의 채팅

            // 2. 상대방 정보 찾기 (우선순위: 채팅방 데이터 -> 캐시된 유저 목록 -> 기본값)
            let otherUser = { displayName: "알 수 없음", photoURL: "https://via.placeholder.com/32" };
            
            // (A) 채팅방 안에 저장된 정보 확인
            if (otherUid && data.participantData && data.participantData[otherUid]) {
                otherUser = data.participantData[otherUid];
            } 
            // (B) [비상 복구] 채팅방에 정보가 없으면 전체 유저 목록에서 검색
            else if (otherUid && cachedUserList.length > 0) {
                const foundUser = cachedUserList.find(u => u.uid === otherUid);
                if (foundUser) otherUser = foundUser;
            }

            // --- 뱃지 로직 ---
            const lastMsgTime = data.lastMessageTime?.toDate()?.getTime() || 0;
            const myReadTime = data[`lastRead_${currentUser.uid}`]?.toDate()?.getTime() || 0;
            const lastSender = data.lastMessageSenderId || ""; 

            const isUnread = (lastMsgTime > myReadTime) && (lastSender !== currentUser.uid);
            const isActive = (currentChatId === chatId);
            const showBadge = isUnread && !isActive;

            html += `
            <div class="dm-item ${isActive?'active':''}" id="chat_item_${chatId}">
                <div class="dm-avatar-wrapper">
                    <img src="${otherUser.photoURL}" class="dm-avatar">
                    ${showBadge ? '<span class="unread-badge-dm"></span>' : ''} 
                </div>
                <span class="name">${otherUser.displayName}</span>
            </div>`;
        });
        
        container.innerHTML = html;

        // 클릭 이벤트 연결
        snapshot.forEach(docSnap => {
            const chatId = docSnap.id;
            const data = docSnap.data();
            
            // 클릭 시 넘겨줄 데이터 구성 (위와 동일한 로직으로 복구)
            let otherUid = data.members ? data.members.find(uid => uid !== currentUser.uid) : null;
            if (!otherUid && data.members) otherUid = currentUser.uid;
            
            let targetUserData = null;
            if (otherUid && data.participantData && data.participantData[otherUid]) {
                targetUserData = { uid: otherUid, ...data.participantData[otherUid] };
            } else if (otherUid && cachedUserList.length > 0) {
                // 비상시 캐시에서 데이터 구성
                const foundUser = cachedUserList.find(u => u.uid === otherUid);
                if (foundUser) targetUserData = { uid: otherUid, ...foundUser };
            }

            const item = getEl(`chat_item_${chatId}`);
            if(item) {
                item.onclick = () => {
                    const badge = item.querySelector('.unread-badge-dm');
                    if(badge) badge.remove();
                    
                    if(targetUserData) startDM(targetUserData);
                    else alert("사용자 정보를 불러올 수 없습니다.");
                };
            }
        });
    });
}

function enterServerChat(serverId, serverName) {
    currentChatId = serverId;
    document.title = serverName;

    getEl('homeView').style.display = 'none';
    getEl('communityView').style.display = 'none';
    getEl('chatView').style.display = 'flex';
    
    getEl('mainHeaderTitle').textContent = serverName;
    getEl('mainHeaderIcon').className = "fas fa-users";
    getEl('sidebarTitle').textContent = serverName;
    getEl('inviteBtn').style.display = 'block';
    
    if(unsubscribeChatList) { unsubscribeChatList(); unsubscribeChatList = null; }
    getEl('sidebarContent').innerHTML = `<div class="channel-category">채널</div><div class="dm-item active"><i class="fas fa-hashtag"></i> 일반</div>`;
    
    if(unsubscribePosts) { unsubscribePosts(); unsubscribePosts = null; }
    
    loadMessages(serverId);
    markAsRead(serverId, true); 
}

async function startDM(targetUser) {
    const uids = [currentUser.uid, targetUser.uid].sort();
    const dmId = `dm_${uids[0]}_${uids[1]}`;
    
    const chatRef = doc(db, "chats", dmId);
    
    // [중요] 채팅방 들어갈 때마다 내 최신 정보로 갱신 (자가 치유 로직)
    await setDoc(chatRef, {
        members: uids,
        participantData: {
            [currentUser.uid]: { displayName: currentUser.displayName, photoURL: currentUser.photoURL },
            [targetUser.uid]: { displayName: targetUser.displayName, photoURL: targetUser.photoURL }
        },
        // 기존 필드가 있으면 유지하고 없으면 생성 (merge: true 덕분)
        [`lastRead_${currentUser.uid}`]: serverTimestamp()
    }, { merge: true });

    resetActiveIcons();
    getEl('homeBtn').classList.add('active');
    
    getEl('homeView').style.display = 'none'; 
    getEl('communityView').style.display = 'none'; 
    getEl('chatView').style.display = 'flex';
    
    currentChatId = dmId;
    document.title = targetUser.displayName; 

    getEl('mainHeaderTitle').textContent = targetUser.displayName; 
    getEl('mainHeaderIcon').className = "fas fa-user"; 
    getEl('inviteBtn').style.display = 'none';
    getEl('sidebarTitle').textContent = "대화"; 
    
    if(unsubscribePosts) { unsubscribePosts(); unsubscribePosts = null; }
    
    loadMessages(dmId);
    markAsRead(dmId, false);
}

async function markAsRead(chatId, isServer = false) {
    if(!currentUser || !chatId) return;
    const updateData = { [`lastRead_${currentUser.uid}`]: serverTimestamp() };
    try {
        if (isServer) await updateDoc(doc(db, "servers", chatId), updateData);
        else await updateDoc(doc(db, "chats", chatId), updateData);
    } catch(e) { console.log("읽음 처리 실패"); }
}

async function leaveServerFromContext() {
    if (!contextMenuServerId || !currentUser) return;
    if (!confirm("서버에서 나가시겠습니까?")) return;
    try {
        await updateDoc(doc(db, "servers", contextMenuServerId), { members: arrayRemove(currentUser.uid) });
        if(currentChatId === contextMenuServerId) showHomeView();
        alert("나갔습니다.");
    } catch (e) { alert("오류: " + e.message); }
}

async function createServer() {
    const name = getEl('newServerName').value.trim();
    if (!name) return;
    await addDoc(collection(db, "servers"), { 
        name, 
        owner: currentUser.uid, 
        members: [currentUser.uid], 
        createdAt: serverTimestamp(),
        lastMessageTime: serverTimestamp(),
        lastMessageSenderId: currentUser.uid,
        [`lastRead_${currentUser.uid}`]: serverTimestamp()
    });
    getEl('serverModal').style.display = 'none';
}
async function joinServer() {
    const id = getEl('joinServerCode').value.trim();
    if (!id) return;
    const ref = doc(db, "servers", id);
    const snap = await getDoc(ref);
    if(snap.exists()) { await updateDoc(ref, { members: arrayUnion(currentUser.uid) }); getEl('serverModal').style.display = 'none'; }
}

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

async function sendMessage(textOverride=null, imageUrl=null) {
    const input = getEl('messageInput');
    const text = textOverride !== null ? textOverride : input.value.trim();

    if ((!text && !imageUrl) || !currentChatId) return;
    if (text.length > 200) { alert("200자 제한"); return; }
    
    const now = Date.now();
    if (now - lastMessageTime < 1000) return; 
    lastMessageTime = now;

    const messageData = {
        text: text || "", imageUrl: imageUrl || null, 
        uid: currentUser.uid, displayName: currentUser.displayName, photoURL: currentUser.photoURL, 
        createdAt: serverTimestamp()
    };

    try {
        const batch = writeBatch(db);
        const msgRef = doc(collection(db, "chats", currentChatId, "messages"));
        batch.set(msgRef, messageData);

        const isServer = !currentChatId.startsWith("dm_");
        
        if (isServer) {
            const serverRef = doc(db, "servers", currentChatId);
            batch.update(serverRef, {
                lastMessageTime: serverTimestamp(),
                lastMessageSenderId: currentUser.uid, 
                [`lastRead_${currentUser.uid}`]: serverTimestamp() 
            });
        } else {
            const chatRef = doc(db, "chats", currentChatId);
            batch.set(chatRef, {
                lastMessageTime: serverTimestamp(),
                lastMessageSenderId: currentUser.uid, 
                [`lastRead_${currentUser.uid}`]: serverTimestamp(),
                members: arrayUnion(currentUser.uid)
            }, { merge: true });
        }

        await batch.commit();
        if(!imageUrl) input.value = '';
    } catch (e) {
        console.error("전송 실패:", e);
        if (e.code === "not-found") alert("채팅방 정보를 찾을 수 없습니다.");
    }
}

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

                if (!isMe && document.hidden) {
                    document.title = "🔴 새 메시지!";
                }
                
                if (!document.hidden && currentChatId === chatId) {
                    const isServer = !chatId.startsWith("dm_");
                    markAsRead(chatId, isServer);
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

// === 유저 목록 로드 및 캐싱 ===
async function loadAllUsers() {
    const q = query(collection(db, "users"));
    const snapshot = await getDocs(q);
    cachedUserList = [];
    const container = getEl('userListContainer');
    container.innerHTML = '';
    
    let count = 0;
    snapshot.forEach(doc => {
        const user = doc.data();
        cachedUserList.push(user); // [중요] 비상 검색을 위해 저장
        
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
function handleSearch(e) {
    const term = e.target.value.toLowerCase();
    document.querySelectorAll('.user-card').forEach(card => card.style.display = card.innerText.toLowerCase().includes(term) ? 'flex' : 'none');
}
