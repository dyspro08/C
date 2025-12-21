import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { 
    getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { 
    getFirestore, collection, addDoc, query, orderBy, onSnapshot, 
    serverTimestamp, setDoc, doc, getDoc, updateDoc, arrayUnion, arrayRemove, where, getDocs 
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
let isServerChat = false; // 현재 채팅이 서버인지 DM인지 구분
let unsubscribeMessages = null;

const getEl = (id) => document.getElementById(id);

document.addEventListener('DOMContentLoaded', () => {
    // 버튼 이벤트 연결
    getEl('googleLoginBtn')?.addEventListener('click', handleLogin);
    getEl('headerLogoutBtn')?.addEventListener('click', () => signOut(auth));
    getEl('messageInput')?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendMessage();
    });
    getEl('sendMsgBtn')?.addEventListener('click', sendMessage);

    getEl('homeBtn')?.addEventListener('click', showHomeView);
    
    // 모달 관련
    getEl('addServerBtn')?.addEventListener('click', () => getEl('serverModal').style.display = 'flex');
    getEl('closeModalBtn')?.addEventListener('click', () => getEl('serverModal').style.display = 'none');
    getEl('createServerBtn')?.addEventListener('click', createServer);
    getEl('joinServerBtn')?.addEventListener('click', joinServer);
    
    getEl('inviteBtn')?.addEventListener('click', copyInviteCode);
    getEl('userSearchInput')?.addEventListener('input', handleSearch);

    // [신규] 서버 나가기 버튼
    getEl('leaveServerBtn')?.addEventListener('click', leaveServer);
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

        // 사용자 정보 저장
        await setDoc(doc(db, "users", user.uid), {
            uid: user.uid, displayName, email: user.email, photoURL: user.photoURL, lastLogin: serverTimestamp()
        }, { merge: true });

        loadMyServers();
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
    getEl('chatView').style.display = 'none';
    getEl('communityView').style.display = 'none';

    getEl('mainHeaderTitle').textContent = "홈";
    getEl('mainHeaderIcon').className = "fas fa-home";
    getEl('sidebarTitle').textContent = "대화";
    getEl('leaveServerBtn').style.display = 'none'; // 홈에서는 나가기 버튼 숨김

    renderRecentDMs();
    loadAllUsers();
}

// === 서버 기능 ===
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
            div.textContent = server.name.substring(0, 1); // 한 글자만
            div.onclick = (e) => {
                resetActiveIcons();
                e.target.classList.add('active');
                enterServerChat(docSnap.id, server.name);
            };
            container.appendChild(div);
        });
    });
}

// 서버 채팅방 입장
function enterServerChat(serverId, serverName) {
    currentChatId = serverId;
    isServerChat = true;

    getEl('homeView').style.display = 'none';
    getEl('chatView').style.display = 'flex';
    
    getEl('mainHeaderTitle').textContent = serverName;
    getEl('mainHeaderIcon').className = "fas fa-users"; // 스페이스 아이콘
    getEl('sidebarTitle').textContent = serverName;
    getEl('inviteSection').style.display = 'block';
    getEl('leaveServerBtn').style.display = 'block'; // [신규] 나가기 버튼 보이기

    getEl('sidebarContent').innerHTML = `
        <div class="channel-category">채널</div>
        <div class="dm-item active">
            <i class="fas fa-hashtag" style="margin-right:10px;"></i> 일반
        </div>
    `;
    loadMessages(serverId);
}

// [신규] 서버 나가기 기능
async function leaveServer() {
    if (!isServerChat || !currentChatId) return;
    if (!confirm("정말 이 스페이스에서 나가시겠습니까?")) return;

    try {
        const serverRef = doc(db, "servers", currentChatId);
        await updateDoc(serverRef, {
            members: arrayRemove(currentUser.uid)
        });
        alert("스페이스에서 나갔습니다.");
        showHomeView();
    } catch (e) {
        console.error(e);
        alert("오류가 발생했습니다.");
    }
}

async function createServer() {
    const name = getEl('newServerName').value.trim();
    if (!name) return;
    try { 
        await addDoc(collection(db, "servers"), { 
            name, owner: currentUser.uid, members: [currentUser.uid], createdAt: serverTimestamp() 
        }); 
        getEl('serverModal').style.display = 'none'; 
    } catch (e) {}
}

async function joinServer() {
    const id = getEl('joinServerCode').value.trim();
    if (!id) return;
    try {
        const ref = doc(db, "servers", id);
        const snap = await getDoc(ref);
        if (snap.exists()) { 
            await updateDoc(ref, { members: arrayUnion(currentUser.uid) }); 
            getEl('serverModal').style.display = 'none'; 
        } else {
            alert("존재하지 않는 코드입니다.");
        }
    } catch (e) {}
}

// === DM 및 최근 대화 ===
function startDM(targetUser) {
    addToRecentDMs(targetUser);
    const uids = [currentUser.uid, targetUser.uid].sort();
    const dmId = `dm_${uids[0]}_${uids[1]}`;
    
    resetActiveIcons();
    getEl('homeBtn').classList.add('active'); // DM은 홈 카테고리
    
    getEl('homeView').style.display = 'none';
    getEl('chatView').style.display = 'flex';
    
    currentChatId = dmId;
    isServerChat = false;
    getEl('mainHeaderTitle').textContent = targetUser.displayName;
    getEl('mainHeaderIcon').className = "fas fa-user";
    getEl('inviteSection').style.display = 'none';
    getEl('leaveServerBtn').style.display = 'none'; // DM에서는 나가기 버튼 숨김

    renderRecentDMs(); // 사이드바 하이라이트 갱신
    loadMessages(dmId);
}

function addToRecentDMs(user) {
    if (!currentUser) return;
    let list = JSON.parse(localStorage.getItem(`recent_dms_${currentUser.uid}`) || "[]");
    list = list.filter(u => u.uid !== user.uid);
    list.unshift({ uid: user.uid, displayName: user.displayName, photoURL: user.photoURL });
    if (list.length > 5) list = list.slice(0, 5);
    localStorage.setItem(`recent_dms_${currentUser.uid}`, JSON.stringify(list));
}

function renderRecentDMs() {
    if (getEl('sidebarTitle').textContent !== "대화") return;

    const list = JSON.parse(localStorage.getItem(`recent_dms_${currentUser.uid}`) || "[]");
    const container = getEl('sidebarContent');
    let html = `<div class="channel-category">최근 대화</div>`;
    
    list.forEach(u => {
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
    list.forEach(u => {
        const item = document.getElementById(`dm_item_${u.uid}`);
        if(item) item.onclick = () => startDM(u);
    });
}

// === 메시지 로드 (말풍선 스타일) ===
function loadMessages(chatId) {
    if (unsubscribeMessages) unsubscribeMessages();
    const container = getEl('messagesContainer');
    
    const q = query(collection(db, "chats", chatId, "messages"), orderBy("createdAt", "asc"));
    unsubscribeMessages = onSnapshot(q, (snapshot) => {
        container.innerHTML = '';
        snapshot.forEach(doc => {
            const msg = doc.data();
            const isMe = msg.uid === currentUser.uid;
            
            // 말풍선 DOM 생성
            const wrapper = document.createElement('div');
            wrapper.className = `message-wrapper ${isMe ? 'me' : 'other'}`;
            
            let html = ``;
            if(!isMe) {
                 html += `
                    <img src="${msg.photoURL}" class="avatar" title="${msg.displayName}">
                    <div class="bubble-group" style="display:flex; flex-direction:column;">
                         <span class="meta">${msg.displayName}</span>
                         <div class="bubble">${msg.text}</div>
                    </div>
                 `;
            } else {
                html += `<div class="bubble">${msg.text}</div>`;
            }
            
            wrapper.innerHTML = html;
            container.appendChild(wrapper);
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

// 기타 유틸
async function loadAllUsers() {
    const q = query(collection(db, "users"));
    const snapshot = await getDocs(q);
    const container = getEl('userListContainer');
    container.innerHTML = '';
    snapshot.forEach(doc => {
        const user = doc.data();
        if (user.uid === currentUser.uid) return;
        const div = document.createElement('div');
        div.className = 'user-card';
        div.innerHTML = `<img src="${user.photoURL}"><div><h4>${user.displayName}</h4></div>`;
        div.onclick = () => startDM(user);
        container.appendChild(div);
    });
    getEl('userCount').textContent = snapshot.size - 1;
}

function handleSearch(e) {
    const term = e.target.value.toLowerCase();
    document.querySelectorAll('.user-card').forEach(card => {
        const name = card.querySelector('h4').innerText.toLowerCase();
        card.style.display = name.includes(term) ? 'flex' : 'none';
    });
}

function copyInviteCode() { navigator.clipboard.writeText(currentChatId).then(() => alert("초대 코드(ID) 복사됨!")); }
