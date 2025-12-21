import { initializeApp } from "firebase/app"; 
import { 
    getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged 
} from "firebase/auth";
import { 
    getFirestore, collection, addDoc, query, orderBy, onSnapshot, 
    serverTimestamp, setDoc, doc, getDocs 
} from "firebase/firestore";

// 1. Firebase 설정
const firebaseConfig = {
    apiKey: "AIzaSyBw2TJjZYZZPd1piCeoFnAXhqEAcCLe1FE",
    authDomain: "chat-7e64b.firebaseapp.com",
    projectId: "chat-7e64b",
    storageBucket: "chat-7e64b.firebasestorage.app",
    messagingSenderId: "1094029259482",
    appId: "1:1094029259482:web:992007326706c5f6bd6be3",
    measurementId: "G-QMTLBH6TX0"
};

// 앱 초기화
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// === 전역 변수 ===
let currentUser = null;
let currentChatId = "general";

// === DOM 요소 가져오기 함수 (안전하게 가져오기 위함) ===
const getEl = (id) => document.getElementById(id);

// === 메인 실행 로직 ===
document.addEventListener('DOMContentLoaded', () => {
    console.log("스크립트 로드 완료: 이벤트 리스너 연결 시작");

    // 1. 로그인 버튼 이벤트 연결
    const loginBtn = getEl('googleLoginBtn');
    if (loginBtn) {
        loginBtn.addEventListener('click', handleLogin);
        console.log("로그인 버튼 연결 성공");
    } else {
        console.error("오류: 로그인 버튼(googleLoginBtn)을 찾을 수 없습니다.");
    }

    // 2. 로그아웃 버튼
    const logoutBtn = getEl('logoutBtn');
    if (logoutBtn) logoutBtn.addEventListener('click', () => signOut(auth));

    // 3. 메시지 전송 (엔터키 & 버튼)
    const msgInput = getEl('messageInput');
    if (msgInput) {
        msgInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') sendMessage();
        });
    }
    
    // 4. 홈 버튼 등 기타 이벤트
    const homeBtn = getEl('homeBtn');
    if(homeBtn) homeBtn.addEventListener('click', showHomeView);

    // 5. 서버 추가 관련
    const addServerBtn = getEl('addServerBtn');
    const closeModalBtn = getEl('closeModalBtn');
    const saveServerBtn = getEl('saveServerBtn');

    if(addServerBtn) addServerBtn.addEventListener('click', () => getEl('serverModal').style.display = 'flex');
    if(closeModalBtn) closeModalBtn.addEventListener('click', () => getEl('serverModal').style.display = 'none');
    if(saveServerBtn) saveServerBtn.addEventListener('click', createServer); // 함수 분리됨

    // 검색창
    const searchInput = getEl('userSearchInput');
    if(searchInput) searchInput.addEventListener('input', handleSearch);

    // 초기 일반 채널 클릭 연결
    const generalServer = document.querySelector('[data-id="general"]');
    if(generalServer) {
        generalServer.addEventListener('click', function() {
            showChatView('general', '일반', false);
            document.querySelectorAll('.server-icon').forEach(el => el.classList.remove('active'));
            this.classList.add('active');
            getEl('currentServerName').textContent = '일반 서버';
        });
    }
});

// === 기능 함수들 ===

// 로그인 처리 함수
async function handleLogin() {
    console.log("로그인 시도 중...");
    try {
        const provider = new GoogleAuthProvider();
        await signInWithPopup(auth, provider);
        console.log("팝업 닫힘");
    } catch (error) {
        console.error("로그인 에러:", error);
        alert("로그인 실패: " + error.message);
    }
}

// 인증 상태 변화 감지 (로그인 성공 시 자동 실행)
onAuthStateChanged(auth, async (user) => {
    const loginOverlay = getEl('loginOverlay');
    const currentUserProfile = getEl('currentUserProfile');

    if (user) {
        console.log("로그인 감지됨:", user.displayName);
        currentUser = user;
        if(loginOverlay) loginOverlay.style.display = 'none';
        if(currentUserProfile) currentUserProfile.style.display = 'flex';
        
        getEl('myAvatar').src = user.photoURL;
        getEl('myName').textContent = user.displayName;

        // DB에 유저 정보 저장
        try {
            await setDoc(doc(db, "users", user.uid), {
                uid: user.uid,
                displayName: user.displayName,
                photoURL: user.photoURL,
                email: user.email,
                lastLogin: serverTimestamp()
            }, { merge: true });
        } catch(e) {
            console.error("유저 정보 저장 실패:", e);
        }

        showHomeView();
    } else {
        console.log("로그아웃 상태");
        currentUser = null;
        if(loginOverlay) loginOverlay.style.display = 'flex';
        if(currentUserProfile) currentUserProfile.style.display = 'none';
    }
});

// 뷰 전환
function showHomeView() {
    getEl('homeView').style.display = 'flex';
    getEl('chatView').style.display = 'none';
    getEl('currentServerName').textContent = "홈";
    getEl('homeBtn').classList.add('active');
    
    // 다른 서버 아이콘 활성 해제
    document.querySelectorAll('.server-icon').forEach(el => {
        if(el.id !== 'homeBtn') el.classList.remove('active');
    });

    loadAllUsers();
}

function showChatView(chatId, title, isDM = false) {
    getEl('homeView').style.display = 'none';
    getEl('chatView').style.display = 'flex';
    
    currentChatId = chatId;
    
    getEl('chatHeaderTitle').textContent = title;
    getEl('chatHeaderIcon').className = isDM ? "fas fa-at" : "fas fa-hashtag";
    
    loadMessages(chatId);
}

// 사용자 목록 로드
async function loadAllUsers() {
    try {
        const q = query(collection(db, "users"));
        const querySnapshot = await getDocs(q);
        renderUserGrid(querySnapshot.docs);
    } catch(e) {
        console.error("사용자 목록 로딩 실패 (DB 규칙 확인 필요):", e);
    }
}

function renderUserGrid(docs) {
    const container = getEl('userListContainer');
    container.innerHTML = '';
    
    docs.forEach(docSnap => {
        const user = docSnap.data();
        if (currentUser && user.uid === currentUser.uid) return; // 나 자신 제외

        const card = document.createElement('div');
        card.className = 'user-card';
        card.innerHTML = `
            <img src="${user.photoURL}" alt="${user.displayName}">
            <h4>${user.displayName}</h4>
            <p>${user.email}</p>
        `;
        card.addEventListener('click', () => startDM(user));
        container.appendChild(card);
    });
}

// 검색 기능
function handleSearch(e) {
    const keyword = e.target.value.toLowerCase();
    const cards = document.querySelectorAll('.user-card');
    cards.forEach(card => {
        const name = card.querySelector('h4').textContent.toLowerCase();
        card.style.display = name.includes(keyword) ? 'flex' : 'none';
    });
}

// DM 시작
function startDM(targetUser) {
    const uids = [currentUser.uid, targetUser.uid].sort();
    const dmId = `dm_${uids[0]}_${uids[1]}`;
    showChatView(dmId, targetUser.displayName, true);
}

// 메시지 로드 (실시간)
let unsubscribeMessages = null;
function loadMessages(chatId) {
    if (unsubscribeMessages) unsubscribeMessages();

    const messagesContainer = getEl('messagesContainer');
    // 채팅방 하위 컬렉션으로 접근
    const messagesRef = collection(db, "chats", chatId, "messages");
    const q = query(messagesRef, orderBy("createdAt", "asc"));

    unsubscribeMessages = onSnapshot(q, (snapshot) => {
        messagesContainer.innerHTML = '';
        if (snapshot.empty) {
            messagesContainer.innerHTML = `<div class="welcome-message"><p>대화가 없습니다. 첫 메시지를 보내보세요!</p></div>`;
        }

        snapshot.forEach((docSnap) => {
            const msg = docSnap.data();
            const messageDiv = document.createElement('div');
            messageDiv.className = 'message';
            
            // 시간 처리
            let timeStr = '...';
            if(msg.createdAt) {
                timeStr = msg.createdAt.toDate().toLocaleTimeString('ko-KR', {hour: '2-digit', minute:'2-digit'});
            }

            messageDiv.innerHTML = `
                <img src="${msg.photoURL}" class="avatar">
                <div class="message-content">
                    <div class="message-info">
                        <span class="username">${msg.displayName}</span>
                        <span class="timestamp">${timeStr}</span>
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
    const input = getEl('messageInput');
    const text = input.value.trim();
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
        input.value = "";
    } catch (error) {
        console.error("전송 실패:", error);
        alert("메시지 전송 실패: 권한이 없거나 네트워크 오류입니다.");
    }
}

// 서버 만들기 (UI만 처리)
function createServer() {
    const input = getEl('newServerName');
    const name = input.value.trim();
    if (!name) return;

    const serverList = getEl('serverList');
    const serverDiv = document.createElement('div');
    serverDiv.className = 'server-icon';
    serverDiv.textContent = name.substring(0, 2);
    serverDiv.title = name;
    
    // 새 서버 클릭 이벤트
    const newServerId = "server_" + Date.now();
    serverDiv.addEventListener('click', () => {
        showChatView(newServerId, name, false);
        document.querySelectorAll('.server-icon').forEach(el => el.classList.remove('active'));
        serverDiv.classList.add('active');
        getEl('currentServerName').textContent = name;
    });

    serverList.appendChild(serverDiv);
    getEl('serverModal').style.display = 'none';
    input.value = '';
}
