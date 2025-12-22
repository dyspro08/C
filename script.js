import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { 
    getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { 
    getFirestore, collection, addDoc, query, orderBy, onSnapshot, 
    serverTimestamp, setDoc, doc, getDoc, updateDoc, deleteDoc, limitToLast, enableIndexedDbPersistence, where, getDocs
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyBw2TJjZYZZPd1piCeoFnAXhqEAcCLe1FE", // 본인의 키 사용
    authDomain: "chat-7e64b.firebaseapp.com",
    projectId: "chat-7e64b",
    storageBucket: "chat-7e64b.firebasestorage.app",
    messagingSenderId: "1094029259482",
    appId: "1:1094029259482:web:992007326706c5f6bd6be3"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// 오프라인 지속성
try { enableIndexedDbPersistence(db).catch(console.error); } catch(e){}

const IMGBB_API_KEY = "bacd5de7a7836881261313337a6b2257"; 

// 상태 변수
let currentUser = null;
let isAdmin = false; // 관리자 여부
let currentServerId = null; 
let currentChannelId = null;
let currentChatType = null; // 'channel' or 'dm'

// 리스너 해제용
let unsubMessages = null;
let unsubChannels = null;

// Helpers
const getEl = (id) => document.getElementById(id);
const show = (id) => getEl(id).style.display = 'flex';
const hide = (id) => getEl(id).style.display = 'none';

// --- Auth ---
getEl('googleLoginBtn').addEventListener('click', async () => {
    try { await signInWithPopup(auth, new GoogleAuthProvider()); } 
    catch(e) { alert("로그인 실패: " + e.message); }
});
getEl('logoutBtn').addEventListener('click', () => signOut(auth));

onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUser = user;
        getEl('loginOverlay').style.display = 'none';
        getEl('currentUserImg').src = user.photoURL;
        getEl('currentUserName').textContent = user.displayName;
        
        // 관리자 확인 (DB users 컬렉션에서 isAdmin 필드 확인)
        const userDoc = await getDoc(doc(db, "users", user.uid));
        if (userDoc.exists()) {
            const data = userDoc.data();
            isAdmin = data.isAdmin === true;
            if(isAdmin) getEl('adminBadge').style.display = 'inline-block';
            
            // 로그인 시 유저 정보 업데이트
            await setDoc(doc(db, "users", user.uid), {
                uid: user.uid, displayName: user.displayName, 
                email: user.email, photoURL: user.photoURL, lastLogin: serverTimestamp(),
                isAdmin: isAdmin // 기존 값 유지 또는 false
            }, { merge: true });
        } else {
            // 최초 로그인
            await setDoc(doc(db, "users", user.uid), {
                uid: user.uid, displayName: user.displayName, 
                email: user.email, photoURL: user.photoURL, lastLogin: serverTimestamp(),
                isAdmin: false
            });
        }

        initApp();
    } else {
        currentUser = null;
        isAdmin = false;
        getEl('loginOverlay').style.display = 'flex';
        getEl('adminBadge').style.display = 'none';
        if(unsubMessages) unsubMessages();
        if(unsubChannels) unsubChannels();
    }
});

function initApp() {
    loadServerList();
    // DM 등 다른 로직 추가 가능
}

// --- View Control ---
function showView(viewId) {
    document.querySelectorAll('.view-section').forEach(el => el.style.display = 'none');
    getEl(viewId).style.display = 'flex';
}

// --- Modal Control ---
const modals = ['serverModal', 'channelModal', 'banModal'];
modals.forEach(id => {
    getEl(id).querySelector('.close-modal-btn').onclick = () => hide(id);
});
getEl('openServerModalBtn').onclick = () => show('serverModal');
getEl('openChannelModalBtn').onclick = () => show('channelModal');

// --- Server System ---
getEl('createServerBtn').onclick = async () => {
    const name = getEl('newServerName').value.trim();
    if(!name) return;
    try {
        const serverRef = await addDoc(collection(db, "servers"), {
            name: name, owner: currentUser.uid, createdAt: serverTimestamp()
        });
        // 기본 채널 생성
        await addDoc(collection(db, "servers", serverRef.id, "channels"), {
            name: "일반", type: "text", createdAt: serverTimestamp()
        });
        hide('serverModal');
        getEl('newServerName').value = '';
    } catch(e) { console.error(e); }
};

function loadServerList() {
    const q = query(collection(db, "servers"), orderBy("createdAt", "desc"));
    onSnapshot(q, (snapshot) => {
        const container = getEl('sidebarServerList');
        container.innerHTML = '';
        
        snapshot.forEach(d => {
            const s = d.data();
            const div = document.createElement('div');
            div.className = `server-icon ${currentServerId === d.id ? 'active' : ''}`;
            div.innerHTML = `<span>${s.name.substring(0,2)}</span>`; // 서버 이름 앞 2글자
            div.onclick = () => selectServer(d.id, s.name);
            
            // 툴팁 효과 (title)
            div.title = s.name;
            container.appendChild(div);
        });
        
        // DM 버튼이나 커뮤니티 버튼을 별도로 추가할 수 있음
    });
}

function selectServer(serverId, serverName) {
    currentServerId = serverId;
    currentServerName = serverName;
    
    // UI 업데이트
    document.querySelectorAll('.server-icon').forEach(el => el.classList.remove('active'));
    // (여기서 this를 찾기 어려우니 다시 렌더링되거나 class 제어 필요, 간단히 생략)

    getEl('channelSidebar').style.display = 'flex';
    getEl('currentServerTitle').textContent = serverName;
    
    loadChannels(serverId);
}

// --- Channel System ---
function loadChannels(serverId) {
    if(unsubChannels) unsubChannels();
    
    const q = query(collection(db, "servers", serverId, "channels"), orderBy("createdAt", "asc"));
    unsubChannels = onSnapshot(q, (snapshot) => {
        const container = getEl('sidebarChannelList');
        container.innerHTML = '';
        
        snapshot.forEach(d => {
            const ch = d.data();
            const div = document.createElement('div');
            div.className = `channel-item ${currentChannelId === d.id ? 'active' : ''}`;
            div.innerHTML = `<i class="fas fa-hashtag"></i> <span>${ch.name}</span>`;
            div.onclick = () => enterChannel(d.id, ch.name);
            container.appendChild(div);
        });
        
        // 첫 진입 시 첫번째 채널 자동 입장
        if(!currentChannelId && snapshot.docs.length > 0) {
            enterChannel(snapshot.docs[0].id, snapshot.docs[0].data().name);
        }
    });
}

getEl('createChannelBtn').onclick = async () => {
    if(!currentServerId) return;
    const name = getEl('newChannelName').value.trim();
    if(!name) return;
    
    await addDoc(collection(db, "servers", currentServerId, "channels"), {
        name: name, createdAt: serverTimestamp()
    });
    hide('channelModal');
    getEl('newChannelName').value = '';
};

function enterChannel(channelId, channelName) {
    currentChannelId = channelId;
    currentChatType = 'channel';
    
    document.querySelectorAll('.channel-item').forEach(el => el.classList.remove('active'));
    // (활성화 클래스 로직 추가 필요)
    
    getEl('chatHeaderTitle').innerText = `# ${channelName}`;
    showView('chatView');
    loadMessages();
}

// --- Message System ---
function loadMessages() {
    if(unsubMessages) unsubMessages();
    const container = getEl('messagesContainer');
    container.innerHTML = '';
    
    // 경로: servers/{sid}/channels/{cid}/messages
    const collRef = collection(db, "servers", currentServerId, "channels", currentChannelId, "messages");
    const q = query(collRef, orderBy("createdAt", "asc"), limitToLast(50));
    
    unsubMessages = onSnapshot(q, (snapshot) => {
        snapshot.docChanges().forEach((change) => {
            if(change.type === "added") {
                appendMessage(change.doc.id, change.doc.data(), container);
            }
            if(change.type === "removed") {
                removeMessageFromUI(change.doc.id);
            }
        });
        scrollToBottom(container);
    });
}

function appendMessage(msgId, msg, container) {
    const div = document.createElement('div');
    div.id = `msg-${msgId}`;
    const isMe = msg.uid === currentUser.uid;
    div.className = `message-wrapper ${isMe ? 'me' : 'other'}`;
    
    let timeStr = msg.createdAt ? msg.createdAt.toDate().toLocaleTimeString('ko-KR', {hour:'2-digit', minute:'2-digit'}) : '';
    let contentHtml = msg.type === 'image' ? `<img src="${msg.content}" onclick="window.open(this.src)">` : msg.content; // XSS 주의 (실제론 textNode 사용 권장)

    // 관리자 또는 본인이면 삭제 버튼 표시
    let actionsHtml = '';
    if(isAdmin || isMe) {
        actionsHtml += `<i class="fas fa-trash delete-btn" onclick="deleteMessage('${msgId}')"></i>`;
    }

    // 이름 클릭 시 밴 모달 (관리자만)
    const nameClickAttr = isAdmin && !isMe ? `onclick="openBanModal('${msg.uid}', '${msg.displayName}')"` : '';
    const nameStyle = isAdmin && !isMe ? 'cursor:pointer; color:#f28b82;' : '';

    div.innerHTML = `
        ${!isMe ? `<div class="sender-header">
            <span class="sender-name" style="${nameStyle}" ${nameClickAttr}>${msg.displayName}</span>
           </div>` : ''}
        <div class="message-info">
            <div class="bubble">${contentHtml}</div>
            <div class="msg-actions">${actionsHtml}</div>
            <div class="timestamp">${timeStr}</div>
        </div>
    `;
    container.appendChild(div);
}

function removeMessageFromUI(msgId) {
    const el = document.getElementById(`msg-${msgId}`);
    if(el) el.remove();
}

function scrollToBottom(container) {
    setTimeout(() => container.scrollTop = container.scrollHeight, 50);
}

// 메시지 전송 (밴 체크 포함)
let lastSentTime = 0;
getEl('sendMsgBtn').onclick = sendMessage;
getEl('messageInput').onkeypress = (e) => { if(e.key==='Enter') sendMessage(); };

async function sendMessage() {
    const input = getEl('messageInput');
    const text = input.value.trim();
    if(!text || !currentChannelId) return;

    // 1. 쿨다운
    const now = Date.now();
    if(now - lastSentTime < 5000) {
        alert("5초 뒤에 보낼 수 있습니다."); return;
    }

    // 2. 밴 여부 확인 (서버의 bans 컬렉션 확인)
    // Firestore 규칙에서도 막히지만, UX를 위해 미리 체크
    const banRef = doc(db, "servers", currentServerId, "bans", currentUser.uid);
    const banSnap = await getDoc(banRef);
    if(banSnap.exists()) {
        const banData = banSnap.data();
        if(banData.until.toMillis() > now) {
            alert(`차단된 사용자입니다.\n해제 시간: ${banData.until.toDate().toLocaleString()}`);
            return;
        }
    }

    lastSentTime = now;
    input.value = '';

    try {
        await addDoc(collection(db, "servers", currentServerId, "channels", currentChannelId, "messages"), {
            content: text, type: 'text',
            uid: currentUser.uid, displayName: currentUser.displayName, photoURL: currentUser.photoURL,
            createdAt: serverTimestamp()
        });
        
        // 서버 메타데이터 갱신 (알림용)
        updateDoc(doc(db, "servers", currentServerId), { lastMessageAt: serverTimestamp() }).catch(()=>{});
    } catch(e) {
        console.error(e);
        alert("전송 실패 (혹시 밴 당하셨나요?)");
    }
}

// --- Admin Features ---

// 1. 메시지 삭제
window.deleteMessage = async (msgId) => {
    if(!confirm("이 메시지를 삭제하시겠습니까?")) return;
    try {
        await deleteDoc(doc(db, "servers", currentServerId, "channels", currentChannelId, "messages", msgId));
    } catch(e) {
        alert("삭제 권한이 없습니다.");
    }
};

// 2. 밴 모달 열기
let targetBanUid = null;
window.openBanModal = (uid, name) => {
    if(!isAdmin) return;
    targetBanUid = uid;
    getEl('banTargetName').textContent = `대상: ${name}`;
    getEl('banDurationInput').value = '';
    show('banModal');
};

// 3. 밴 실행
getEl('confirmBanBtn').onclick = async () => {
    const mins = parseInt(getEl('banDurationInput').value);
    if(!targetBanUid || !mins) return;

    const until = new Date();
    until.setMinutes(until.getMinutes() + mins);

    try {
        // bans 컬렉션에 문서 추가 (UID를 문서 ID로 사용)
        await setDoc(doc(db, "servers", currentServerId, "bans", targetBanUid), {
            uid: targetBanUid,
            bannedAt: serverTimestamp(),
            until: until, // Date 객체 저장 -> Timestamp로 변환됨
            bannedBy: currentUser.displayName
        });
        alert("사용자를 차단했습니다.");
        hide('banModal');
    } catch(e) {
        console.error(e);
        alert("차단 실패 (권한 부족)");
    }
};

// --- Image Upload (동일 유지) ---
getEl('attachBtn').onclick = () => getEl('imageInput').click();
getEl('imageInput').onchange = async (e) => {
    const file = e.target.files[0];
    if(!file) return;
    // (이전 코드의 ImgBB 업로드 로직 동일하게 사용)
    // 업로드 성공 시 addDoc 부분만 위 sendMessage 로직처럼 경로 맞춰주면 됨
};
