import { initializeApp } from "firebase/app";
import { 
    getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged 
} from "firebase/auth";
import { 
    getFirestore, collection, addDoc, query, orderBy, onSnapshot, 
    serverTimestamp, setDoc, doc, getDocs 
} from "firebase/firestore";

// Firebase 설정
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

// === 상태 변수 ===
let currentUser = null;
let currentChatId = "general"; // 현재 보고 있는 채팅방 ID (기본: general)
let isDmMode = false; // 현재 DM 중인지 확인
let unsubscribeMessages = null; // 리스너 해제용

// === DOM 요소 ===
const loginOverlay = document.getElementById('loginOverlay');
const homeView = document.getElementById('homeView');
const chatView = document.getElementById('chatView');
const messagesContainer = document.getElementById('messagesContainer');
const messageInput = document.getElementById('messageInput');
const userListContainer = document.getElementById('userListContainer');
const userSearchInput = document.getElementById('userSearchInput');
const chatHeaderTitle = document.getElementById('chatHeaderTitle');
const chatHeaderIcon = document.getElementById('chatHeaderIcon');

// === 1. 인증 및 사용자 관리 ===

// 로그인
document.getElementById('googleLoginBtn').addEventListener('click', async () => {
    try {
        const provider = new GoogleAuthProvider();
        await signInWithPopup(auth, provider);
    } catch (error) {
        console.error(error);
    }
});

// 로그아웃
document.getElementById('logoutBtn').addEventListener('click', () => signOut(auth));

// 인증 상태 변화 감지
onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUser = user;
        loginOverlay.style.display = 'none';
        
        // 내 프로필 UI 업데이트
        document.getElementById('myAvatar').src = user.photoURL;
        document.getElementById('myName').textContent = user.displayName;

        // DB에 사용자 정보 저장/업데이트 (중요: 검색을 위해 필요)
        await setDoc(doc(db, "users", user.uid), {
            uid: user.uid,
            displayName: user.displayName,
            photoURL: user.photoURL,
            email: user.email,
            lastLogin: serverTimestamp()
        }, { merge: true });

        // 초기 화면 로드 (홈 화면)
        showHomeView();
    } else {
        currentUser = null;
        loginOverlay.style.display = 'flex';
    }
});

// === 2. 뷰 전환 로직 (홈 vs 채팅) ===

function showHomeView() {
    homeView.style.display = 'flex';
    chatView.style.display = 'none';
    document.getElementById('currentServerName').textContent = "홈";
    document.getElementById('homeBtn').classList.add('active');
    
    // 사이드바의 다른 활성 상태 제거
    document.querySelectorAll('.server-icon').forEach(el => {
        if(el.id !== 'homeBtn') el.classList.remove('active');
    });

    loadAllUsers(); // 사용자 목록 불러오기
}

function showChatView(chatId, title, isDM = false) {
    homeView.style.display = 'none';
    chatView.style.display = 'flex';
    
    currentChatId = chatId;
    isDmMode = isDM;
    
    chatHeaderTitle.textContent = title;
    chatHeaderIcon.className = isDM ? "fas fa-at" : "fas fa-hashtag"; // 아이콘 변경
    
    loadMessages(chatId);
}

// 홈 버튼 클릭 이벤트
document.getElementById('homeBtn').addEventListener('click', showHomeView);

// === 3. 사용자 목록 및 DM 기능 ===

async function loadAllUsers() {
    const q = query(collection(db, "users"));
    const querySnapshot = await getDocs(q);
    
    // 렌더링 함수
    renderUserGrid(querySnapshot.docs);
}

function renderUserGrid(docs) {
    userListContainer.innerHTML = '';
    
    docs.forEach(doc => {
        const user = doc.data();
        // 나 자신은 목록에서 뺄 수도 있음 (선택사항)
        if (user.uid === currentUser.uid) return;

        const card = document.createElement('div');
        card.className = 'user-card';
        card.innerHTML = `
            <img src="${user.photoURL}" alt="${user.displayName}">
            <h4>${user.displayName}</h4>
            <p>${user.email}</p>
        `;
        
        // 클릭 시 DM 시작
        card.addEventListener('click', () => startDM(user));
        userListContainer.appendChild(card);
    });
}

// 사용자 검색 기능
userSearchInput.addEventListener('input', (e) => {
    const keyword = e.target.value.toLowerCase();
    const cards = document.querySelectorAll('.user-card');
    
    cards.forEach(card => {
        const name = card.querySelector('h4').textContent.toLowerCase();
        if (name.includes(keyword)) {
            card.style.display = 'flex';
        } else {
            card.style.display = 'none';
        }
    });
});

// DM 시작 로직
function startDM(targetUser) {
    // 1:1 채팅방 ID 생성 규칙: 두 유저의 UID를 정렬해서 합침 (항상 고유함)
    const uids = [currentUser.uid, targetUser.uid].sort();
    const dmId = `dm_${uids[0]}_${uids[1]}`;
    
    // 뷰 전환
    showChatView(dmId, targetUser.displayName, true);
}

// === 4. 채팅 기능 (통합) ===

function loadMessages(chatId) {
    // 이전 리스너가 있다면 해제 (메모리 누수 방지)
    if (unsubscribeMessages) unsubscribeMessages();

    // 동적 컬렉션 경로: chats -> {chatId} -> messages
    // 주의: Firestore 구조를 'chats' 컬렉션 하나로 통합 관리
    const messagesRef = collection(db, "chats", chatId, "messages");
    const q = query(messagesRef, orderBy("createdAt", "asc"));

    unsubscribeMessages = onSnapshot(q, (snapshot) => {
        messagesContainer.innerHTML = '';
        
        if (snapshot.empty) {
            messagesContainer.innerHTML = `<div class="welcome-message"><p>대화의 시작입니다!</p></div>`;
        }

        snapshot.forEach((doc) => {
            const msg = doc.data();
            const messageDiv = document.createElement('div');
            messageDiv.className = 'message';
            
            // 시간 표시
            const time = msg.createdAt ? msg.createdAt.toDate().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '...';

            messageDiv.innerHTML = `
                <img src="${msg.photoURL}" class="avatar">
                <div class="message-content">
                    <div class="message-info">
                        <span class="username">${msg.displayName}</span>
                        <span class="timestamp">${time}</span>
                    </div>
                    <div class="message-text">${msg.text}</div>
                </div>
            `;
            messagesContainer.appendChild(messageDiv);
        });
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    });
}

// 메시지 전송
async function sendMessage() {
    const text = messageInput.value.trim();
    if (text === "" || !currentUser) return;

    try {
        const messagesRef = collection(db, "chats", currentChatId, "messages");
        await addDoc(messagesRef, {
            text: text,
            uid: currentUser.uid,
            displayName: currentUser.displayName,
            photoURL: currentUser.photoURL,
            createdAt: serverTimestamp()
        });
        messageInput.value = "";
    } catch (error) {
        console.error("전송 실패:", error);
    }
}

messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
});

// === 5. 서버 추가 기능 ===

const serverModal = document.getElementById('serverModal');
const addServerBtn = document.getElementById('addServerBtn');
const closeModalBtn = document.getElementById('closeModalBtn');
const saveServerBtn = document.getElementById('saveServerBtn');
const newServerName = document.getElementById('newServerName');
const serverList = document.getElementById('serverList');

// 모달 열기
addServerBtn.addEventListener('click', () => serverModal.style.display = 'flex');
// 모달 닫기
closeModalBtn.addEventListener('click', () => serverModal.style.display = 'none');

// 서버 만들기
saveServerBtn.addEventListener('click', async () => {
    const name = newServerName.value.trim();
    if (!name) return;

    // UI에 서버 아이콘 추가 (간단 구현)
    // 실제로는 DB 'servers' 컬렉션에 저장하고 onSnapshot으로 불러와야 함
    const serverDiv = document.createElement('div');
    serverDiv.className = 'server-icon';
    serverDiv.textContent = name.substring(0, 2); // 앞 2글자만 표시
    serverDiv.title = name;
    
    // 서버 클릭 이벤트 (일반 채팅방으로 이동 예시)
    const newServerId = "server_" + Date.now();
    serverDiv.addEventListener('click', () => {
        showChatView(newServerId, name, false);
        document.querySelectorAll('.server-icon').forEach(el => el.classList.remove('active'));
        serverDiv.classList.add('active');
        document.getElementById('currentServerName').textContent = name;
    });

    serverList.appendChild(serverDiv);
    
    serverModal.style.display = 'none';
    newServerName.value = '';
});

// 초기화: 기본 채널 이벤트 연결
document.querySelector('[data-id="general"]').addEventListener('click', function() {
    showChatView('general', '일반', false);
    document.querySelectorAll('.server-icon').forEach(el => el.classList.remove('active'));
    this.classList.add('active');
    document.getElementById('currentServerName').textContent = '일반 서버';
});
