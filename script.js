// CDN Import (GitHub Pages 호환)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { 
    getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { 
    getFirestore, collection, addDoc, query, orderBy, onSnapshot, 
    serverTimestamp, setDoc, doc, getDoc, updateDoc, arrayUnion, where
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
let isDmMode = true; // true: 홈(친구), false: 서버
let unsubscribeMessages = null;

// === DOM 요소 유틸 ===
const getEl = (id) => document.getElementById(id);

// === 초기화 ===
document.addEventListener('DOMContentLoaded', () => {
    // 로그인/로그아웃
    getEl('googleLoginBtn')?.addEventListener('click', handleLogin);
    getEl('logoutBtn')?.addEventListener('click', () => signOut(auth));

    // 메시지 전송
    getEl('messageInput')?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendMessage();
    });

    // 탭 전환
    getEl('homeBtn')?.addEventListener('click', showHomeView);
    
    // 모달 관련
    getEl('addServerBtn')?.addEventListener('click', () => getEl('serverModal').style.display = 'flex');
    getEl('closeModalBtn')?.addEventListener('click', () => getEl('serverModal').style.display = 'none');
    
    // 서버 생성 및 참가
    getEl('createServerBtn')?.addEventListener('click', createServer);
    getEl('joinServerBtn')?.addEventListener('click', joinServer);

    // 초대 버튼
    getEl('inviteBtn')?.addEventListener('click', copyInviteCode);

    // 검색
    getEl('userSearchInput')?.addEventListener('input', handleSearch);
});

// === 1. 인증 및 관리자 설정 ===
async function handleLogin() {
    try {
        await signInWithPopup(auth, new GoogleAuthProvider());
    } catch (error) {
        alert("로그인 실패: " + error.message);
    }
}

onAuthStateChanged(auth, async (user) => {
    const loginOverlay = getEl('loginOverlay');
    const profileArea = getEl('currentUserProfile');

    if (user) {
        // [중요] 관리자 칭호 로직
        let displayName = user.displayName;
        if (user.email === 'yudongyun08@gmail.com') {
            displayName = "관리자";
        }

        currentUser = { ...user, displayName: displayName }; // 로컬 객체 업데이트

        // UI 업데이트
        loginOverlay.style.display = 'none';
        getEl('myAvatar').src = user.photoURL;
        getEl('myName').textContent = displayName;
        getEl('myTag').textContent = "#" + user.uid.substring(0, 4);

        // DB에 유저 정보 저장 (검색용)
        await setDoc(doc(db, "users", user.uid), {
            uid: user.uid,
            displayName: displayName,
            email: user.email,
            photoURL: user.photoURL,
            lastLogin: serverTimestamp()
        }, { merge: true });

        // 내 서버 목록 불러오기
        loadMyServers();
        // 초기화면: 홈
        showHomeView();

    } else {
        currentUser = null;
        loginOverlay.style.display = 'flex';
    }
});

// === 2. 뷰 전환 ===
function showHomeView() {
    isDmMode = true;
    currentChatId = null;
    
    // UI 전환
    getEl('homeView').style.display = 'flex';
    getEl('chatView').style.display = 'none';
    getEl('inviteSection').style.display = 'none'; // 홈에선 초대 버튼 숨김

    // 사이드바 활성 상태
    document.querySelectorAll('.server-icon').forEach(el => el.classList.remove('active'));
    getEl('homeBtn').classList.add('active');

    // 채널 사이드바 내용 변경
    getEl('sidebarTitle').textContent = "다이렉트 메시지";
    loadAllUsers(); // 친구 목록 로드
}

function showServerView(serverId, serverName) {
    isDmMode = false;
    currentChatId = serverId;

    getEl('homeView').style.display = 'none';
    getEl('chatView').style.display = 'flex';
    
    // 헤더 설정
    getEl('chatHeaderTitle').textContent = serverName;
    getEl('chatHeaderIcon').className = "fas fa-hashtag";
    getEl('sidebarTitle').textContent = serverName;
    getEl('inviteSection').style.display = 'block'; // 서버에선 초대 버튼 보임

    // 채널 사이드바를 '채팅 채널'로 변경 (가짜 데이터)
    const channelList = getEl('channelListArea');
    channelList.innerHTML = `
        <div class="channel-category">채팅 채널</div>
        <div class="channel-item active"><i class="fas fa-hashtag"></i> 일반</div>
        <div class="channel-item"><i class="fas fa-hashtag"></i> 공지사항</div>
    `;

    loadMessages(serverId);
}

// === 3. 서버 기능 (만들기/참가하기) ===

// 내 서버 목록 불러오기 (실시간)
function loadMyServers() {
    if (!currentUser) return;
    
    // 내가 멤버로 포함된 서버만 쿼리
    const q = query(collection(db, "servers"), where("members", "array-contains", currentUser.uid));
    
    onSnapshot(q, (snapshot) => {
        const container = getEl('serverListContainer');
        container.innerHTML = ''; // 초기화

        snapshot.forEach((docSnap) => {
            const server = docSnap.data();
            const div = document.createElement('div');
            div.className = 'server-icon';
            div.title = server.name;
            
            // 아이콘이 없으면 글자 앞 2자리
            div.textContent = server.name.substring(0, 2);
            
            div.onclick = () => {
                document.querySelectorAll('.server-icon').forEach(el => el.classList.remove('active'));
                div.classList.add('active');
                showServerView(docSnap.id, server.name);
            };

            container.appendChild(div);
        });
    });
}

// 서버 만들기
async function createServer() {
    const nameInput = getEl('newServerName');
    const name = nameInput.value.trim();
    if (!name) return alert("서버 이름을 입력하세요.");

    try {
        await addDoc(collection(db, "servers"), {
            name: name,
            owner: currentUser.uid,
            members: [currentUser.uid], // 나 자신 추가
            createdAt: serverTimestamp()
        });
        getEl('serverModal').style.display = 'none';
        nameInput.value = '';
    } catch (e) {
        alert("서버 생성 실패: " + e.message);
    }
}

// 서버 참가하기 (초대코드 = Doc ID)
async function joinServer() {
    const codeInput = getEl('joinServerCode');
    const serverId = codeInput.value.trim();
    if (!serverId) return alert("초대 코드를 입력하세요.");

    try {
        const serverRef = doc(db, "servers", serverId);
        const serverSnap = await getDoc(serverRef);

        if (serverSnap.exists()) {
            await updateDoc(serverRef, {
                members: arrayUnion(currentUser.uid)
            });
            alert(`${serverSnap.data().name} 서버에 참가했습니다!`);
            getEl('serverModal').style.display = 'none';
            codeInput.value = '';
        } else {
            alert("존재하지 않는 초대 코드(서버 ID)입니다.");
        }
    } catch (e) {
        console.error(e);
        alert("참가 실패: 이미 참가 중이거나 오류가 발생했습니다.");
    }
}

// 초대 코드 복사
function copyInviteCode() {
    if (!currentChatId || isDmMode) return;
    navigator.clipboard.writeText(currentChatId).then(() => {
        alert(`초대 코드(서버 ID)가 복사되었습니다!\n친구에게 알려주세요: ${currentChatId}`);
    });
}

// === 4. 친구/DM 및 메시지 ===

async function loadAllUsers() {
    // 친구 목록 렌더링 (이전 코드와 유사하되 스타일 변경)
    const q = query(collection(db, "users"));
    const snapshot = await getDocs(q);
    const container = getEl('userListContainer');
    container.innerHTML = '';

    snapshot.forEach(doc => {
        const user = doc.data();
        if (user.uid === currentUser.uid) return;

        const div = document.createElement('div');
        div.className = 'user-card';
        div.innerHTML = `
            <img src="${user.photoURL}">
            <div>
                <h4>${user.displayName}</h4>
                <p>온라인</p>
            </div>
        `;
        div.onclick = () => startDM(user);
        container.appendChild(div);
    });
}

function startDM(targetUser) {
    // 1:1 채팅방 ID 생성
    const uids = [currentUser.uid, targetUser.uid].sort();
    const dmId = `dm_${uids[0]}_${uids[1]}`;
    
    // 화면 전환
    isDmMode = true;
    currentChatId = dmId;
    
    getEl('homeView').style.display = 'none';
    getEl('chatView').style.display = 'flex';
    getEl('chatHeaderTitle').textContent = targetUser.displayName;
    getEl('chatHeaderIcon').className = "fas fa-at";
    
    // 사이드바에 '친구' 대신 DM 상대 표시하는 UI 로직은 생략(심플함 유지)
    loadMessages(dmId);
}

// 메시지 로드
function loadMessages(chatId) {
    if (unsubscribeMessages) unsubscribeMessages();
    const container = getEl('messagesContainer');
    
    // chatId가 컬렉션 문서 ID가 됨. 그 아래 messages 서브 컬렉션
    const messagesRef = collection(db, "chats", chatId, "messages");
    const q = query(messagesRef, orderBy("createdAt", "asc"));

    unsubscribeMessages = onSnapshot(q, (snapshot) => {
        container.innerHTML = '';
        if (snapshot.empty) {
            container.innerHTML = `<div style="padding:20px; color:#72767d;">첫 메시지를 보내보세요!</div>`;
        }

        snapshot.forEach(doc => {
            const msg = doc.data();
            const el = document.createElement('div');
            el.className = 'message';
            // 시간
            let time = msg.createdAt ? new Date(msg.createdAt.seconds * 1000).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : '';
            
            el.innerHTML = `
                <img src="${msg.photoURL}" class="avatar">
                <div class="content">
                    <span class="username">${msg.displayName}</span>
                    <span class="timestamp">${time}</span>
                    <div class="message-text">${msg.text}</div>
                </div>
            `;
            container.appendChild(el);
        });
        container.scrollTop = container.scrollHeight;
    });
}

async function sendMessage() {
    const input = getEl('messageInput');
    const text = input.value.trim();
    if (!text || !currentChatId) return;

    try {
        await addDoc(collection(db, "chats", currentChatId, "messages"), {
            text: text,
            uid: currentUser.uid,
            displayName: currentUser.displayName, // 관리자는 여기서 '관리자'로 들어감
            photoURL: currentUser.photoURL,
            createdAt: serverTimestamp()
        });
        input.value = '';
    } catch(e) {
        console.error(e);
    }
}

function handleSearch(e) {
    const term = e.target.value.toLowerCase();
    const items = document.querySelectorAll('.user-card');
    items.forEach(item => {
        const name = item.querySelector('h4').innerText.toLowerCase();
        item.style.display = name.includes(term) ? 'flex' : 'none';
    });
}
