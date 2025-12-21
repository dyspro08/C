import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { 
    getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { 
    getFirestore, collection, addDoc, query, orderBy, onSnapshot, 
    serverTimestamp, setDoc, doc, getDoc, updateDoc, arrayUnion, where, getDocs 
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

// === 전역 상태 ===
let currentUser = null;
let currentChatId = null;
let currentPostId = null;
let unsubscribeMessages = null;
let unsubscribePosts = null;
let unsubscribeComments = null;

const getEl = (id) => document.getElementById(id);

document.addEventListener('DOMContentLoaded', () => {
    // 버튼 이벤트
    getEl('googleLoginBtn')?.addEventListener('click', handleLogin);
    getEl('headerLogoutBtn')?.addEventListener('click', () => signOut(auth));
    getEl('settingsBtn')?.addEventListener('click', () => alert("설정 기능은 준비 중입니다."));
    getEl('messageInput')?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendMessage();
    });

    // 네비게이션
    getEl('homeBtn')?.addEventListener('click', showHomeView);
    getEl('communityBtn')?.addEventListener('click', showCommunityView);

    // 서버
    getEl('addServerBtn')?.addEventListener('click', () => getEl('serverModal').style.display = 'flex');
    getEl('closeModalBtn')?.addEventListener('click', () => getEl('serverModal').style.display = 'none');
    getEl('createServerBtn')?.addEventListener('click', createServer);
    getEl('joinServerBtn')?.addEventListener('click', joinServer);
    getEl('inviteBtn')?.addEventListener('click', copyInviteCode);

    // 커뮤니티
    getEl('writePostBtn')?.addEventListener('click', showWriteForm);
    getEl('cancelPostBtn')?.addEventListener('click', () => {
        getEl('postWriteSection').style.display = 'none';
        getEl('postListSection').style.display = 'flex';
    });
    getEl('submitPostBtn')?.addEventListener('click', submitPost);
    getEl('backToListBtn')?.addEventListener('click', showCommunityView);
    getEl('submitCommentBtn')?.addEventListener('click', submitComment);

    // 검색
    getEl('userSearchInput')?.addEventListener('input', handleSearch);
});

// === 로그인 ===
async function handleLogin() {
    try { await signInWithPopup(auth, new GoogleAuthProvider()); } 
    catch (e) { alert("로그인 오류: " + e.message); }
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
        // 로그인 시 최근 대화 목록 불러와서 사이드바에 표시
        renderRecentDMs();
        showHomeView();
    } else {
        currentUser = null;
        getEl('loginOverlay').style.display = 'flex';
    }
});

// === 화면 전환 ===

function resetActiveIcons() {
    document.querySelectorAll('.server-icon').forEach(el => el.classList.remove('active'));
}

function showHomeView() {
    resetActiveIcons();
    getEl('homeBtn').classList.add('active');

    getEl('homeView').style.display = 'flex';
    getEl('communityView').style.display = 'none';
    getEl('chatView').style.display = 'none';

    getEl('sidebarTitle').textContent = "다이렉트 메시지";
    getEl('mainHeaderTitle').textContent = "친구";
    getEl('mainHeaderIcon').className = "fas fa-user-friends";
    
    // 사이드바에는 항상 최근 대화 목록 표시
    renderRecentDMs();
    
    loadAllUsers();
}

function showCommunityView() {
    resetActiveIcons();
    getEl('communityBtn').classList.add('active');

    getEl('homeView').style.display = 'none';
    getEl('communityView').style.display = 'flex';
    getEl('chatView').style.display = 'none';

    getEl('postListSection').style.display = 'flex';
    getEl('postWriteSection').style.display = 'none';
    getEl('postDetailSection').style.display = 'none';

    getEl('sidebarTitle').textContent = "커뮤니티";
    getEl('mainHeaderTitle').textContent = "자유게시판";
    getEl('mainHeaderIcon').className = "fas fa-globe";
    
    getEl('sidebarContent').innerHTML = `
        <div class="channel-category">게시판</div>
        <div class="channel-item active" style="padding: 8px; color:white; background:#393c43; border-radius:4px;">
            <i class="fas fa-list"></i> 자유게시판
        </div>
    `;
    loadCommunityPosts();
}

function showServerView(serverId, serverName) {
    resetActiveIcons();
    
    getEl('homeView').style.display = 'none';
    getEl('communityView').style.display = 'none';
    getEl('chatView').style.display = 'flex';
    
    currentChatId = serverId;
    getEl('mainHeaderTitle').textContent = serverName;
    getEl('mainHeaderIcon').className = "fas fa-hashtag";
    getEl('sidebarTitle').textContent = serverName;
    getEl('inviteSection').style.display = 'block';

    getEl('sidebarContent').innerHTML = `
        <div class="channel-category">채팅 채널</div>
        <div class="channel-item active" style="padding:6px 8px; border-radius:4px; color:white; background:#393c43;">
            <i class="fas fa-hashtag"></i> 일반
        </div>
    `;
    loadMessages(serverId);
}

// === 최근 대화 목록 관리 (LocalStorage 사용) ===
function getRecentDMs() {
    if (!currentUser) return [];
    const key = `recent_dms_${currentUser.uid}`;
    const data = localStorage.getItem(key);
    return data ? JSON.parse(data) : [];
}

function addToRecentDMs(user) {
    if (!currentUser) return;
    let list = getRecentDMs();
    
    // 이미 있는지 확인 (있으면 제거 후 맨 앞으로 보냄)
    list = list.filter(u => u.uid !== user.uid);
    
    // 맨 앞에 추가
    list.unshift({
        uid: user.uid,
        displayName: user.displayName,
        photoURL: user.photoURL
    });

    // 5명 제한
    if (list.length > 5) {
        list = list.slice(0, 5);
    }

    localStorage.setItem(`recent_dms_${currentUser.uid}`, JSON.stringify(list));
    renderRecentDMs();
}

function renderRecentDMs() {
    // 현재 보고 있는 화면이 '홈'이거나 'DM 채팅'일 때만 사이드바 업데이트
    const sidebarTitle = getEl('sidebarTitle').textContent;
    if (sidebarTitle !== "다이렉트 메시지") return;

    const list = getRecentDMs();
    const container = getEl('sidebarContent');
    
    let html = `<div class="channel-category">최근 메세지</div>`;
    
    list.forEach(u => {
        // 현재 채팅 중인 사람인지 확인
        const uids = [currentUser.uid, u.uid].sort();
        const dmId = `dm_${uids[0]}_${uids[1]}`;
        const isActive = (currentChatId === dmId);
        
        html += `
            <div class="dm-item ${isActive ? 'active' : ''}" id="dm_item_${u.uid}">
                <img src="${u.photoURL}">
                <span class="name">${u.displayName}</span>
            </div>
        `;
    });
    
    container.innerHTML = html;

    // 클릭 이벤트 연결
    list.forEach(u => {
        const item = document.getElementById(`dm_item_${u.uid}`);
        if(item) {
            item.onclick = () => startDM(u);
        }
    });
}


// === 기능들 ===

async function loadAllUsers() {
    const q = query(collection(db, "users"));
    const snapshot = await getDocs(q);
    const container = getEl('userListContainer');
    container.innerHTML = '';
    
    let count = 0;
    snapshot.forEach(doc => {
        const user = doc.data();
        if (user.uid === currentUser.uid) return;
        count++;
        const div = document.createElement('div');
        div.className = 'user-card';
        div.innerHTML = `<img src="${user.photoURL}"><div><h4>${user.displayName}</h4></div>`;
        div.onclick = () => startDM(user);
        container.appendChild(div);
    });
    getEl('userCount').textContent = count;
}

function startDM(targetUser) {
    // 1. 최근 대화 목록에 추가 및 저장
    addToRecentDMs(targetUser);

    const uids = [currentUser.uid, targetUser.uid].sort();
    const dmId = `dm_${uids[0]}_${uids[1]}`;
    
    resetActiveIcons();
    getEl('homeBtn').classList.add('active');
    
    getEl('homeView').style.display = 'none';
    getEl('communityView').style.display = 'none';
    getEl('chatView').style.display = 'flex';
    
    currentChatId = dmId;
    getEl('mainHeaderTitle').textContent = targetUser.displayName;
    getEl('mainHeaderIcon').className = "fas fa-at";
    getEl('inviteSection').style.display = 'none';
    
    // 사이드바 갱신 (active 상태 반영을 위해)
    renderRecentDMs();

    loadMessages(dmId);
}

// ... 나머지 커뮤니티, 서버, 메시지 로드 함수들은 기존과 동일 유지 ...

function loadCommunityPosts() {
    if (unsubscribePosts) unsubscribePosts();
    const container = getEl('postsContainer');
    const q = query(collection(db, "posts"), orderBy("createdAt", "desc"));
    unsubscribePosts = onSnapshot(q, (snapshot) => {
        container.innerHTML = '';
        if(snapshot.empty) container.innerHTML = '<div style="color:#72767d; text-align:center; margin-top:20px;">게시글이 없습니다.</div>';
        snapshot.forEach(docSnap => {
            const post = docSnap.data();
            const date = post.createdAt ? new Date(post.createdAt.seconds * 1000).toLocaleDateString() : '';
            const div = document.createElement('div');
            div.className = 'post-item';
            div.innerHTML = `<h3>${post.title}</h3><div class="post-info"><span>${post.authorName}</span> • <span>${date}</span></div>`;
            div.onclick = () => showPostDetail(docSnap.id, post);
            container.appendChild(div);
        });
    });
}
function showWriteForm() {
    getEl('postListSection').style.display = 'none';
    getEl('postWriteSection').style.display = 'flex';
    getEl('postTitleInput').value = '';
    getEl('postContentInput').value = '';
}
async function submitPost() {
    const title = getEl('postTitleInput').value.trim();
    const content = getEl('postContentInput').value.trim();
    if (!title || !content) return;
    await addDoc(collection(db, "posts"), {
        title, content, authorUid: currentUser.uid, authorName: currentUser.displayName, createdAt: serverTimestamp()
    });
    showCommunityView();
}
function showPostDetail(postId, postData) {
    currentPostId = postId;
    getEl('postListSection').style.display = 'none';
    getEl('postDetailSection').style.display = 'flex';
    getEl('detailTitle').textContent = postData.title;
    getEl('detailAuthor').textContent = postData.authorName;
    getEl('detailDate').textContent = postData.createdAt ? new Date(postData.createdAt.seconds*1000).toLocaleString() : '';
    getEl('detailContent').textContent = postData.content;
    loadComments(postId);
}
function loadComments(postId) {
    if (unsubscribeComments) unsubscribeComments();
    const container = getEl('commentsContainer');
    const q = query(collection(db, "posts", postId, "comments"), orderBy("createdAt", "asc"));
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
    await addDoc(collection(db, "posts", currentPostId, "comments"), {
        text, authorName: currentUser.displayName, uid: currentUser.uid, createdAt: serverTimestamp()
    });
    getEl('commentInput').value = '';
}
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
            div.textContent = server.name.substring(0, 2);
            div.onclick = (e) => {
                document.querySelectorAll('.server-icon').forEach(el => el.classList.remove('active'));
                e.target.classList.add('active');
                showServerView(docSnap.id, server.name);
            };
            container.appendChild(div);
        });
    });
}
async function createServer() {
    const name = getEl('newServerName').value.trim();
    if (!name) return;
    try { await addDoc(collection(db, "servers"), { name, owner: currentUser.uid, members: [currentUser.uid], createdAt: serverTimestamp() }); getEl('serverModal').style.display = 'none'; } catch (e) {}
}
async function joinServer() {
    const id = getEl('joinServerCode').value.trim();
    if (!id) return;
    try {
        const ref = doc(db, "servers", id);
        const snap = await getDoc(ref);
        if (snap.exists()) { await updateDoc(ref, { members: arrayUnion(currentUser.uid) }); getEl('serverModal').style.display = 'none'; }
    } catch (e) {}
}
function copyInviteCode() { navigator.clipboard.writeText(currentChatId).then(() => alert("코드 복사됨")); }
function handleSearch(e) {
    const term = e.target.value.toLowerCase();
    document.querySelectorAll('.user-card').forEach(card => {
        const name = card.querySelector('h4').innerText.toLowerCase();
        card.style.display = name.includes(term) ? 'flex' : 'none';
    });
}
function loadMessages(chatId) {
    if (unsubscribeMessages) unsubscribeMessages();
    const container = getEl('messagesContainer');
    const q = query(collection(db, "chats", chatId, "messages"), orderBy("createdAt", "asc"));
    unsubscribeMessages = onSnapshot(q, (snapshot) => {
        container.innerHTML = '';
        snapshot.forEach(doc => {
            const msg = doc.data();
            const el = document.createElement('div');
            el.className = 'message';
            let time = msg.createdAt ? new Date(msg.createdAt.seconds*1000).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : '';
            el.innerHTML = `<img src="${msg.photoURL}" class="avatar"><div class="content"><span class="username">${msg.displayName}</span><span class="timestamp">${time}</span><div class="message-text">${msg.text}</div></div>`;
            container.appendChild(el);
        });
        container.scrollTop = container.scrollHeight;
    });
}
async function sendMessage() {
    const input = getEl('messageInput');
    const text = input.value.trim();
    if (!text || !currentChatId) return;
    await addDoc(collection(db, "chats", currentChatId, "messages"), {
        text, uid: currentUser.uid, displayName: currentUser.displayName, photoURL: currentUser.photoURL, createdAt: serverTimestamp()
    });
    input.value = '';
}
