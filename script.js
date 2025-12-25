import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { 
    getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { 
    getFirestore, collection, addDoc, query, orderBy, onSnapshot, 
    serverTimestamp, setDoc, doc, getDoc, updateDoc, arrayUnion, arrayRemove, where, getDocs, deleteDoc,
    writeBatch
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// === 설정 (변경 없음) ===
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

// === 전역 변수 ===
let currentUser = null;
let currentServerId = null; 
let currentChatId = null; 
let currentPostId = null;
let cachedUserList = [];
let unsubscribeChat = null;
let unsubscribeComments = null;

// === 1. 인증 관리 ===
// 로그인 상태 변화 감지
onAuthStateChanged(auth, (user) => {
    if (user) {
        currentUser = user;
        getEl('loginOverlay').style.display = 'none';
        
        // 내 정보 갱신/저장
        setDoc(doc(db, "users", user.uid), {
            uid: user.uid,
            displayName: user.displayName,
            photoURL: user.photoURL,
            email: user.email,
            lastLogin: serverTimestamp()
        }, { merge: true });

        initApp();
    } else {
        currentUser = null;
        getEl('loginOverlay').style.display = 'flex';
    }
});

// 로그인 버튼 이벤트 (즉시 바인딩)
const loginBtn = document.getElementById('googleLoginBtn');
if(loginBtn) {
    loginBtn.addEventListener('click', () => {
        const provider = new GoogleAuthProvider();
        signInWithPopup(auth, provider).catch(error => {
            console.error("Login failed:", error);
            alert("로그인 실패: " + error.message);
        });
    });
}

// === 2. 초기화 및 네비게이션 ===
function initApp() {
    loadServerList();
    loadRecentChats(); // 사이드바 DM 목록
    loadAllUsers();    // 검색용 전체 유저 캐싱
    
    // 초기 화면: Home
    showHome();
}

// 네비게이션 버튼 이벤트
getEl('btnHome').addEventListener('click', showHome);
getEl('btnCommunity').addEventListener('click', showCommunity);

function showHome() {
    getEl('homeView').style.display = 'block';
    getEl('communityView').style.display = 'none';
    getEl('chatView').style.display = 'none';
    
    // UI 초기화
    document.querySelectorAll('.server-icon').forEach(el => el.classList.remove('active'));
    getEl('btnHome').classList.add('active');
    
    renderHome();
}

function showCommunity() {
    getEl('homeView').style.display = 'none';
    getEl('communityView').style.display = 'flex';
    getEl('chatView').style.display = 'none';
    
    document.querySelectorAll('.server-icon').forEach(el => el.classList.remove('active'));
    getEl('postDetailView').style.display = 'none';
    getEl('postListView').style.display = 'block';
    
    loadPosts();
}

function showChatView() {
    getEl('homeView').style.display = 'none';
    getEl('communityView').style.display = 'none';
    getEl('chatView').style.display = 'flex';
}

// === 3. 홈 화면 (친구/검색) ===
function loadAllUsers() {
    getDocs(collection(db, "users")).then(snap => {
        cachedUserList = [];
        snap.forEach(d => cachedUserList.push(d.data()));
        renderHome(); // 데이터 로드 후 렌더링
    });
}

function renderHome() {
    const container = getEl('userListContainer');
    if(!container) return; // homeView에 userListContainer가 있다고 가정
    // index.html 구조상 homeView 내부를 비우고 다시 그림
    // 편의상 검색창 + 리스트 구조 유지
    
    // 여기서는 간단히 userListContainer를 찾아서 렌더링한다고 가정하지만
    // index.html의 homeView 내부 구조에 맞춰 재구성합니다.
    const homeView = getEl('homeView');
    homeView.innerHTML = `
        <div class="search-bar-container">
            <input type="text" id="userSearchInput" placeholder="친구 검색...">
        </div>
        <div class="user-list" id="userListResults"></div>
    `;
    
    renderUserList(cachedUserList);
    
    // 검색 이벤트
    getEl('userSearchInput').addEventListener('input', handleSearch);
}

function handleSearch(e) {
    const term = e.target.value.toLowerCase();
    const filtered = cachedUserList.filter(u => 
        (u.displayName && u.displayName.toLowerCase().includes(term)) ||
        (u.email && u.email.toLowerCase().includes(term))
    );
    renderUserList(filtered);
}

function renderUserList(users) {
    const container = getEl('userListResults');
    container.innerHTML = '';
    users.forEach(u => {
        if(u.uid === currentUser.uid) return; // 나 자신 제외
        
        const div = document.createElement('div');
        div.className = 'user-card'; // CSS 필요 (기존 style에 있다고 가정 or 추가)
        div.innerHTML = `
            <img src="${u.photoURL || 'https://via.placeholder.com/40'}" class="profile-pic">
            <div class="user-info">
                <div class="user-name">${u.displayName}</div>
                <div class="user-status">${u.email}</div>
            </div>
            <button class="chat-btn" onclick="startDM('${u.uid}')"><i class="fas fa-comment"></i></button>
        `;
        container.appendChild(div);
    });
}

// ★★★ 중요: HTML onclick에서 호출할 수 있도록 window 객체에 할당 ★★★
async function startDM(targetUid) {
    // 1. 이미 존재하는 1:1 채팅방 확인
    // Firestore 쿼리가 복잡하므로, 간단히 chats 컬렉션을 검색하거나
    // participantUIDs 배열을 사용하여 쿼리합니다.
    // 여기서는 "두 명만 포함된" 채팅방을 찾습니다.
    
    // 효율을 위해: 채팅방 ID를 생성해서 체크 (uid1_uid2 정렬)
    const uids = [currentUser.uid, targetUid].sort();
    const chatId = uids.join('_');
    
    // 문서 존재 확인
    const chatDocRef = doc(db, "chats", chatId);
    const chatDoc = await getDoc(chatDocRef);
    
    if (!chatDoc.exists()) {
        // 채팅방 생성
        await setDoc(chatDocRef, {
            type: 'dm',
            participants: uids,
            participantData: {
                [currentUser.uid]: { name: currentUser.displayName, photo: currentUser.photoURL },
                // 상대방 정보는 cachedUserList에서 찾거나, 일단 기본값
            },
            lastMessage: '',
            lastMessageTime: serverTimestamp(),
            unreadCount: { [targetUid]: 0, [currentUser.uid]: 0 } // 간단 구현
        });
        
        // 상대방 정보 업데이트 (cachedUserList 활용)
        const targetUser = cachedUserList.find(u => u.uid === targetUid);
        if(targetUser) {
            await updateDoc(chatDocRef, {
                [`participantData.${targetUid}`]: { name: targetUser.displayName, photo: targetUser.photoURL }
            });
        }
    }
    
    // 채팅방 열기
    enterChat(chatId, 'dm');
}
// 전역으로 노출 (버그 수정의 핵심)
window.startDM = startDM;


// === 4. 채팅 기능 ===
function loadRecentChats() {
    const q = query(collection(db, "chats"), where("participants", "array-contains", currentUser.uid), orderBy("lastMessageTime", "desc"));
    
    onSnapshot(q, (snapshot) => {
        const list = getEl('dmList');
        list.innerHTML = '';
        
        let totalUnread = 0; // 전체 안읽음 (필요시)

        snapshot.forEach(doc => {
            const data = doc.data();
            const cid = doc.id;
            
            // DM 이름/사진 결정
            let title = data.name;
            let photo = '';
            
            if (data.type === 'dm') {
                const otherUid = data.participants.find(id => id !== currentUser.uid);
                const otherData = data.participantData ? data.participantData[otherUid] : null;
                title = otherData ? otherData.name : '알 수 없음';
                photo = otherData ? otherData.photo : '';
            }
            
            // 안읽음 배지 계산 로직 (기존 유지)
            // 간단히: lastMessageTime > 내가 읽은 시간 체크
            // 여기선 UI만 그립니다.
            
            const div = document.createElement('div');
            div.className = 'dm-item';
            div.innerHTML = `
                <img src="${photo || 'https://via.placeholder.com/30'}" style="width:30px;height:30px;border-radius:50%;margin-right:10px;">
                <div class="dm-info">
                    <div class="dm-title">${title}</div>
                    <div class="dm-preview">${data.lastMessage || '대화 시작'}</div>
                </div>
            `;
            // 안읽음 표시 (빨간 점) 로직이 있다면 여기에 추가
            // 예: if (isUnread) div.innerHTML += `<span class="unread-dot"></span>`;
            
            div.addEventListener('click', () => enterChat(cid, data.type));
            list.appendChild(div);
        });
    });
}

function enterChat(chatId, type) {
    currentChatId = chatId;
    currentServerId = null;
    
    showChatView();
    loadMessages(chatId);
    
    // UI 업데이트 (선택 효과)
    document.querySelectorAll('.dm-item').forEach(el => el.classList.remove('active'));
    // (선택된 항목 highlight 로직 추가 가능)
}

function loadMessages(chatId) {
    if(unsubscribeChat) unsubscribeChat();
    
    const container = getEl('messagesContainer');
    const q = query(collection(db, "chats", chatId, "messages"), orderBy("createdAt", "asc"));
    
    unsubscribeChat = onSnapshot(q, (snapshot) => {
        container.innerHTML = '';
        let lastUid = null;
        
        snapshot.forEach(doc => {
            const m = doc.data();
            const isMe = m.senderUid === currentUser.uid;
            
            const div = document.createElement('div');
            div.className = `message ${isMe ? 'me' : 'other'}`;
            
            // 프로필 사진 표시 여부 (연속된 메시지면 생략 가능하지만 일단 표시)
            let profileHtml = '';
            if (!isMe) {
                profileHtml = `<img src="${m.senderPhoto || 'https://via.placeholder.com/30'}" class="msg-profile">`;
            }
            
            // 내용 (이미지 처리)
            let contentHtml = `<div class="bubble">${escapeHtml(m.text)}</div>`;
            if (m.imageUrl) {
                contentHtml = `<div class="bubble"><img src="${m.imageUrl}" class="msg-image"><br>${escapeHtml(m.text)}</div>`;
            }
            
            div.innerHTML = profileHtml + contentHtml;
            container.appendChild(div);
        });
        
        // 스크롤 하단으로
        container.scrollTop = container.scrollHeight;
    });
}

// 메시지 전송
getEl('sendMsgBtn').addEventListener('click', sendMessage);
getEl('messageInput').addEventListener('keypress', (e) => {
    if(e.key === 'Enter') sendMessage();
});

// 이미지 붙여넣기 기능
getEl('messageInput').addEventListener('paste', handlePasteUpload);

async function handlePasteUpload(e) {
    const items = (e.clipboardData || e.originalEvent.clipboardData).items;
    let file = null;
    for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf("image") === 0) {
            file = items[i].getAsFile();
            break;
        }
    }
    if (!file) return;
    
    // ImgBB 업로드
    uploadImageAndSend(file);
}

// 첨부 버튼
getEl('attachBtn').addEventListener('click', () => getEl('imageInput').click());
getEl('imageInput').addEventListener('change', (e) => {
    if(e.target.files[0]) uploadImageAndSend(e.target.files[0]);
});

async function uploadImageAndSend(file) {
    // ImgBB API Key (주의: 클라이언트에 노출됨)
    const API_KEY = "6a0487968560946059d4370123543666"; 
    const formData = new FormData();
    formData.append("image", file);
    
    try {
        const res = await fetch(`https://api.imgbb.com/1/upload?key=${API_KEY}`, {
            method: 'POST',
            body: formData
        });
        const data = await res.json();
        if (data.success) {
            sendMessage(data.data.url);
        } else {
            alert("이미지 업로드 실패");
        }
    } catch(err) {
        console.error(err);
        alert("업로드 중 오류 발생");
    }
}

async function sendMessage(imageUrl = null) {
    const input = getEl('messageInput');
    const text = input.value.trim();
    
    if ((!text && !imageUrl) || !currentChatId) return;
    
    const msgData = {
        text: text,
        imageUrl: imageUrl, // URL만 저장
        senderUid: currentUser.uid,
        senderName: currentUser.displayName,
        senderPhoto: currentUser.photoURL,
        createdAt: serverTimestamp()
    };
    
    input.value = '';
    
    // 배치 처리 (메시지 추가 + 채팅방 정보 갱신)
    const batch = writeBatch(db);
    const msgRef = doc(collection(db, "chats", currentChatId, "messages"));
    batch.set(msgRef, msgData);
    
    const chatRef = doc(db, "chats", currentChatId);
    batch.update(chatRef, {
        lastMessage: imageUrl ? '사진을 보냈습니다.' : text,
        lastMessageTime: serverTimestamp()
    });
    
    await batch.commit();
}


// === 5. 커뮤니티 기능 ===
function loadPosts() {
    const list = getEl('postsList');
    // 최신순 정렬
    const q = query(collection(db, "posts"), orderBy("createdAt", "desc"), limit(50));
    
    onSnapshot(q, (snapshot) => {
        list.innerHTML = '';
        snapshot.forEach(doc => {
            const p = doc.data();
            const div = document.createElement('div');
            div.className = 'post-item';
            div.innerHTML = `
                <div class="post-title">${p.title}</div>
                <div class="post-meta">
                    <span>${p.authorName}</span>
                    <span>${p.createdAt ? new Date(p.createdAt.seconds*1000).toLocaleDateString() : ''}</span>
                </div>
                ${p.uid === currentUser.uid ? `<button onclick="deletePost('${doc.id}')" style="float:right;color:red;">삭제</button>` : ''}
            `;
            // 제목 클릭 시 상세 보기
            div.querySelector('.post-title').addEventListener('click', () => openPostDetail(doc.id, p));
            list.appendChild(div);
        });
    });
}
// 전역 노출
window.deletePost = deletePost; 

async function deletePost(pid) {
    if(confirm("정말 삭제하시겠습니까?")) {
        await deleteDoc(doc(db, "posts", pid));
    }
}

function openPostDetail(pid, pdata) {
    currentPostId = pid;
    getEl('postListView').style.display = 'none';
    getEl('postDetailView').style.display = 'block';
    
    getEl('detailTitle').textContent = pdata.title;
    getEl('detailAuthor').textContent = pdata.authorName;
    getEl('detailContent').textContent = pdata.content;
    getEl('detailDate').textContent = pdata.createdAt?new Date(pdata.createdAt.seconds*1000).toLocaleString():'';
    
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

getEl('submitCommentBtn').addEventListener('click', submitComment);

async function submitComment() {
    const text = getEl('commentInput').value.trim();
    if(!text || !currentPostId) return;
    
    await addDoc(collection(db, "posts", currentPostId, "comments"), {
        text,
        authorName: currentUser.displayName,
        uid: currentUser.uid,
        createdAt: serverTimestamp()
    });
    getEl('commentInput').value = '';
}

// 글쓰기 관련 (생략된 HTML 요소가 있다면 script 오류 방지를 위해 체크)
const writeBtn = getEl('writePostBtn');
if(writeBtn) {
    writeBtn.addEventListener('click', () => {
        // 모달 열기 구현 필요 (생략)
        // 여기서는 간단히 프롬프트로 대체하거나 UI에 모달이 있다고 가정
        const title = prompt("제목:");
        const content = prompt("내용:");
        if(title && content) {
            addDoc(collection(db, "posts"), {
                title, content, 
                authorName: currentUser.displayName,
                uid: currentUser.uid,
                createdAt: serverTimestamp()
            });
        }
    });
}

// 서버(스페이스) 만들기 모달
getEl('addServerBtn').addEventListener('click', () => {
    getEl('serverModal').style.display = 'flex';
});
getEl('closeModalBtn').addEventListener('click', () => {
    getEl('serverModal').style.display = 'none';
});
getEl('createServerBtn').addEventListener('click', async () => {
    const name = getEl('newServerName').value;
    if(!name) return;
    
    await addDoc(collection(db, "servers"), {
        name,
        ownerUid: currentUser.uid,
        members: [currentUser.uid],
        createdAt: serverTimestamp()
    });
    getEl('serverModal').style.display = 'none';
    getEl('newServerName').value = '';
});

// 서버 목록 로드
function loadServerList() {
    const list = getEl('serverList'); 
    // 기본 홈, 커뮤니티 아이콘은 HTML에 고정되어 있으므로 그 뒤에 추가
    // 여기서는 onSnapshot으로 서버 목록을 받아와서 동적으로 그림
    
    const q = query(collection(db, "servers"), where("members", "array-contains", currentUser.uid));
    
    onSnapshot(q, (snapshot) => {
        // 기존 서버 아이콘들 제거 (홈, 커뮤니티, +버튼 제외하고)
        // 구현이 까다로우니, HTML 구조에 id="dynamicServerList"를 만들어두면 좋음.
        // 여기서는 편의상 .dynamic-server 클래스를 가진 애들만 지우고 다시 그림
        document.querySelectorAll('.dynamic-server').forEach(e => e.remove());
        
        const refNode = getEl('addServerBtn'); // 이 버튼 앞에 추가
        
        snapshot.forEach(doc => {
            const s = doc.data();
            const div = document.createElement('div');
            div.className = 'server-icon dynamic-server';
            div.innerText = s.name.substring(0,2);
            div.title = s.name;
            div.onclick = () => {
                alert("서버 기능은 아직 구현 중입니다. (DM 및 커뮤니티 이용)");
            };
            
            list.insertBefore(div, refNode);
        });
    });
}


// === 유틸리티 ===
function getEl(id) {
    return document.getElementById(id);
}

function escapeHtml(text) {
    if (!text) return text;
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}
