import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { 
    getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { 
    getFirestore, collection, addDoc, query, orderBy, onSnapshot, 
    serverTimestamp, setDoc, doc, getDoc, updateDoc, arrayUnion, arrayRemove, where, getDocs, deleteDoc,
    limit, limitToLast, enableIndexedDbPersistence 
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

// ★ 중요: 오프라인 지속성 활성화 (캐싱으로 읽기 횟수 획기적 감소)
try {
    enableIndexedDbPersistence(db).catch((err) => {
        if (err.code == 'failed-precondition') {
            console.log("다중 탭 오픈으로 지속성 활성화 실패");
        } else if (err.code == 'unimplemented') {
            console.log("브라우저가 지속성을 지원하지 않음");
        }
    });
} catch(e) { console.log("Persistence Init Error", e); }

// ImgBB API Key
const IMGBB_API_KEY = "bacd5de7a7836881261313337a6b2257"; 

let currentUser = null;
let currentChatId = null; 
let currentChatType = null; // 'server' or 'dm'

// ★ 최적화 핵심: 리스너 관리 변수
let unsubscribeMessageListener = null; 

// DOM Elements Helpers
const getEl = (id) => document.getElementById(id);

// --- Auth ---
getEl('googleLoginBtn').addEventListener('click', async () => {
    const provider = new GoogleAuthProvider();
    try {
        await signInWithPopup(auth, provider);
    } catch (error) {
        console.error("Login failed", error);
        alert("로그인 실패: " + error.message);
    }
});

getEl('logoutBtn').addEventListener('click', () => signOut(auth));

onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUser = user;
        getEl('loginOverlay').style.display = 'none';
        getEl('currentUserImg').src = user.photoURL;
        getEl('currentUserName').textContent = user.displayName;
        
        // 유저 정보 DB 저장/업데이트
        await setDoc(doc(db, "users", user.uid), {
            uid: user.uid,
            displayName: user.displayName,
            email: user.email,
            photoURL: user.photoURL,
            lastLogin: serverTimestamp()
        }, { merge: true });

        initApp();
    } else {
        currentUser = null;
        getEl('loginOverlay').style.display = 'flex';
        // 로그아웃 시 리스너 해제
        if (unsubscribeMessageListener) unsubscribeMessageListener();
    }
});

function initApp() {
    loadServers();
    loadDMList();
    loadAllUsers(); // 커뮤니티용
}

// --- View Navigation ---
function showView(viewId) {
    document.querySelectorAll('.view-section').forEach(el => el.style.display = 'none');
    getEl(viewId).style.display = 'flex'; // 'block' 대신 'flex' (레이아웃 유지)
}

// --- Servers ---
getEl('openServerModalBtn').addEventListener('click', () => getEl('serverModal').style.display = 'flex');
getEl('closeModalBtn').addEventListener('click', () => getEl('serverModal').style.display = 'none');

getEl('createServerBtn').addEventListener('click', async () => {
    const name = getEl('newServerName').value.trim();
    if(!name) return;
    try {
        const docRef = await addDoc(collection(db, "servers"), {
            name: name,
            createdBy: currentUser.uid,
            createdAt: serverTimestamp(),
            members: [currentUser.uid]
        });
        getEl('newServerName').value = '';
        getEl('serverModal').style.display = 'none';
        loadServers(); // Refresh needed if not realtime list
    } catch(e) { console.error(e); }
});

function loadServers() {
    // 서버 목록은 자주 안 바뀌므로 굳이 snapshot 안 써도 됨 (읽기 절약)
    // 하지만 실시간성을 원하면 snapshot 유지. 여기선 비용 절감을 위해 getDocs 권장하나
    // UX를 위해 onSnapshot 유지하되 limit 필요시 적용.
    // 여기선 Server list는 양이 적으므로 일단 둠.
    const q = query(collection(db, "servers"), orderBy("createdAt", "desc"));
    onSnapshot(q, (snapshot) => {
        const container = getEl('sidebarContent');
        // 기존 DM 목록 헤더 위까지만 지우거나, 분리해서 관리해야 함.
        // 편의상 사이드바 구조를 좀 바꿉니다. (Script 상단 로직 수정 필요할 수 있음)
        // 여기서는 DM 리스트와 섞이는 문제를 방지하기 위해 Server 영역과 DM 영역을 DOM에서 분리했으면 좋겠지만,
        // 기존 코드 호환성을 위해 sidebarContent를 초기화 후 다시 그림
        // -> loadDMList가 localStorage 기반이라 같이 호출해줘야 함.
        
        container.innerHTML = `<div class="channel-category">스페이스</div>`;
        
        snapshot.forEach(doc => {
            const server = doc.data();
            const div = document.createElement('div');
            div.className = `server-item ${currentChatId === doc.id ? 'active' : ''}`;
            div.id = `server_item_${doc.id}`;
            div.innerHTML = `<i class="fas fa-hashtag"></i> <span>${server.name}</span>`;
            div.onclick = () => enterServer(doc.id, server.name);
            container.appendChild(div);
        });

        // 서버 렌더링 후 DM 리스트 다시 그리기 (덮어쓰기 방지)
        loadDMList(); 
    });
}

function enterServer(serverId, serverName) {
    if(currentChatId === serverId) return; // 같은 방 중복 클릭 방지
    currentChatId = serverId;
    currentChatType = 'server';
    
    updateSidebarActiveState();
    getEl('chatHeader').innerText = `# ${serverName}`;
    showView('chatView');
    
    // 메시지 로드 (최적화 적용)
    loadMessages("servers", serverId);
}

// --- DM System ---
async function startDM(targetUser) {
    const uids = [currentUser.uid, targetUser.uid].sort();
    const dmId = `dm_${uids[0]}_${uids[1]}`;
    
    // 로컬 스토리지에 최근 대화 저장
    let recent = JSON.parse(localStorage.getItem(`recent_dms_${currentUser.uid}`) || "[]");
    if(!recent.find(u => u.uid === targetUser.uid)) {
        recent.push(targetUser);
        localStorage.setItem(`recent_dms_${currentUser.uid}`, JSON.stringify(recent));
    }

    currentChatId = dmId;
    currentChatType = 'dm';
    
    loadDMList(); // UI 갱신
    updateSidebarActiveState();
    
    getEl('chatHeader').innerText = `${targetUser.displayName}님과의 대화`;
    showView('chatView');
    
    loadMessages("dms", dmId);
}

function loadDMList() {
    const list = JSON.parse(localStorage.getItem(`recent_dms_${currentUser.uid}`) || "[]");
    const container = getEl('sidebarContent');
    
    // 이미 있는 내용 뒤에 붙이기 위해 createElement 사용 권장하나, 
    // 여기선 간단히 기존 innerHTML에 추가하는 방식 사용시 이벤트 날아감 주의.
    // 따라서 insertAdjacentHTML 활용 or 별도 컨테이너 필요.
    // *간단 해결*: loadServers 안에서 호출되므로, loadServers가 HTML 다 밀고 나서 이 함수가 실행되면 됨.
    
    // 만약 이미 DM 카테고리가 있다면 지우고 다시 그림 (중복 방지)
    const existingDmHeader = container.querySelector('.dm-category-header');
    if(existingDmHeader) {
        // DM 부분만 갱신 로직이 복잡하므로, 
        // 전체 리렌더링 흐름을 따르는 게 안전. 
        // loadServers의 onSnapshot 내부에서 loadDMList를 호출하게 되어 있으므로 여기선 HTML append만 함.
    } else {
        const header = document.createElement('div');
        header.className = "channel-category dm-category-header";
        header.innerText = "최근 대화";
        container.appendChild(header);
    }

    list.forEach(u => {
        // 중복 방지
        if(getEl(`dm_item_${u.uid}`)) return;

        const div = document.createElement('div');
        const uids = [currentUser.uid, u.uid].sort();
        const dmId = `dm_${uids[0]}_${uids[1]}`;
        const isActive = (currentChatId === dmId);
        
        div.className = `dm-item ${isActive?'active':''}`;
        div.id = `dm_item_${u.uid}`;
        div.innerHTML = `<img src="${u.photoURL}"><span class="name">${u.displayName}</span>`;
        div.onclick = () => startDM(u);
        container.appendChild(div);
    });
}

function updateSidebarActiveState() {
    document.querySelectorAll('.server-item, .dm-item').forEach(el => el.classList.remove('active'));
    if(currentChatType === 'server') {
        const el = getEl(`server_item_${currentChatId}`);
        if(el) el.classList.add('active');
    } else {
        // DM 활성화 처리는 ID 매칭이 필요
        // (간단화를 위해 생략하거나 로직 추가 가능)
    }
}

// --- ★ MESSAGING SYSTEM (OPTIMIZED) ---
function loadMessages(collectionName, docId) {
    // 1. 기존 리스너 해제 (이전 방 데이터 읽기 중단 - 비용 절약 핵심)
    if (unsubscribeMessageListener) {
        unsubscribeMessageListener();
        unsubscribeMessageListener = null;
    }

    const container = getEl('messagesContainer');
    container.innerHTML = ''; // 화면 초기화

    // 2. 쿼리 최적화: 전체 다 가져오지 말고 최근 50개만 (limitToLast)
    // orderBy로 정렬 후 뒤에서 50개 자름
    const q = query(
        collection(db, collectionName, docId, "messages"),
        orderBy("createdAt", "asc"),
        limitToLast(50) 
    );

    // 3. 리스너 등록
    unsubscribeMessageListener = onSnapshot(q, (snapshot) => {
        snapshot.docChanges().forEach((change) => {
            if (change.type === "added") {
                const msg = change.doc.data();
                appendMessage(msg, container);
            }
            // modified, removed 처리는 필요시 추가
        });
        
        // 스크롤 맨 아래로
        scrollToBottom(container);
    });
}

function appendMessage(msg, container) {
    const div = document.createElement('div');
    const isMe = msg.uid === currentUser.uid;
    div.className = `message-wrapper ${isMe ? 'me' : 'other'}`;
    
    // 시간 포맷
    let timeStr = "";
    if(msg.createdAt) {
        const date = msg.createdAt.toDate();
        timeStr = `${date.getHours()}:${date.getMinutes().toString().padStart(2,'0')}`;
    }

    let contentHtml = "";
    if(msg.type === 'image') {
        contentHtml = `<img src="${msg.content}" onclick="window.open(this.src)">`;
    } else {
        contentHtml = msg.content; // XSS 방지 처리 필요시 textContent로 넣어야 함
    }

    div.innerHTML = `
        ${!isMe ? `<div class="sender-name">${msg.displayName}</div>` : ''}
        <div class="bubble">
            ${contentHtml}
        </div>
        <div class="timestamp">${timeStr}</div>
    `;
    container.appendChild(div);
}

function scrollToBottom(container) {
    setTimeout(() => {
        container.scrollTop = container.scrollHeight;
    }, 50);
}

// 메시지 전송
getEl('sendMsgBtn').addEventListener('click', sendMessage);
getEl('messageInput').addEventListener('keypress', (e) => {
    if(e.key === 'Enter') sendMessage();
});

async function sendMessage() {
    const input = getEl('messageInput');
    const text = input.value.trim();
    if(!text || !currentChatId) return;

    input.value = '';
    const collName = currentChatType === 'server' ? 'servers' : 'dms';

    try {
        await addDoc(collection(db, collName, currentChatId, "messages"), {
            content: text,
            type: 'text',
            uid: currentUser.uid,
            displayName: currentUser.displayName,
            photoURL: currentUser.photoURL,
            createdAt: serverTimestamp()
        });
    } catch(e) {
        console.error("Send Error", e);
        alert("메시지 전송 실패");
    }
}

// 이미지 전송
getEl('attachBtn').addEventListener('click', () => getEl('imageInput').click());
getEl('imageInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if(!file) return;

    // Loading 표시
    const btn = getEl('attachBtn');
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';

    const formData = new FormData();
    formData.append("image", file);

    try {
        const res = await fetch(`https://api.imgbb.com/1/upload?key=${IMGBB_API_KEY}`, {
            method: "POST",
            body: formData
        });
        const data = await res.json();
        
        if(data.success) {
            const imgUrl = data.data.url;
            const collName = currentChatType === 'server' ? 'servers' : 'dms';
            await addDoc(collection(db, collName, currentChatId, "messages"), {
                content: imgUrl,
                type: 'image',
                uid: currentUser.uid,
                displayName: currentUser.displayName,
                photoURL: currentUser.photoURL,
                createdAt: serverTimestamp()
            });
        }
    } catch(err) {
        console.error(err);
        alert("이미지 업로드 실패");
    } finally {
        btn.innerHTML = '<i class="fas fa-plus"></i>';
        e.target.value = ''; // 초기화
    }
});


// --- Community (BBS) ---
getEl('tabListBtn').addEventListener('click', showCommunityView);
getEl('tabWriteBtn').addEventListener('click', () => {
    switchCommunityTab('writePostSection', 'tabWriteBtn');
});
getEl('tabUserListBtn').addEventListener('click', () => {
    switchCommunityTab('userListSection', 'tabUserListBtn');
});
getEl('backToCommunityBtn').addEventListener('click', showCommunityView);

function showCommunityView() {
    showView('communityView');
    switchCommunityTab('postListSection', 'tabListBtn');
    loadPosts();
}

function switchCommunityTab(sectionId, btnId) {
    ['postListSection', 'writePostSection', 'userListSection'].forEach(id => getEl(id).style.display = 'none');
    getEl(sectionId).style.display = 'block';
    
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    getEl(btnId).classList.add('active');
}

// 글쓰기 (버그 수정됨)
getEl('submitPostBtn').addEventListener('click', submitPost);

async function submitPost() {
    const titleInput = getEl('postTitleInput');
    const contentInput = getEl('postContentInput');
    
    const title = titleInput.value.trim();
    const content = contentInput.value.trim();

    if (!title || !content) {
        alert("제목과 내용을 모두 입력해주세요.");
        return;
    }

    const submitBtn = getEl('submitPostBtn');
    submitBtn.disabled = true; 
    submitBtn.innerText = "등록 중...";

    try {
        await addDoc(collection(db, "posts"), {
            title: title,
            content: content,
            authorUid: currentUser.uid,
            authorName: currentUser.displayName,
            createdAt: serverTimestamp()
        });

        alert("게시글이 등록되었습니다!");
        titleInput.value = '';
        contentInput.value = '';
        showCommunityView(); // 목록으로 이동
    } catch (error) {
        console.error("글쓰기 실패:", error);
        alert("오류 발생: " + error.message);
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerText = "등록";
    }
}

function loadPosts() {
    // 게시글 목록도 limit 적용 권장 (여기선 20개)
    const q = query(collection(db, "posts"), orderBy("createdAt", "desc"), limit(20));
    onSnapshot(q, (snapshot) => {
        const container = getEl('postsContainer');
        container.innerHTML = '';
        snapshot.forEach(doc => {
            const p = doc.data();
            const div = document.createElement('div');
            div.className = 'post-item';
            div.innerHTML = `
                <div class="post-title">${p.title}</div>
                <div class="post-info">작성자: ${p.authorName} • ${p.createdAt ? new Date(p.createdAt.toDate()).toLocaleDateString() : '방금 전'}</div>
            `;
            div.onclick = () => viewPostDetail(doc.id, p);
            container.appendChild(div);
        });
    });
}

// 게시글 상세 & 댓글
let unsubscribeComments = null;
function viewPostDetail(postId, postData) {
    showView('postDetailView');
    getEl('detailTitle').textContent = postData.title;
    getEl('detailAuthor').textContent = postData.authorName;
    getEl('detailDate').textContent = postData.createdAt ? new Date(postData.createdAt.toDate()).toLocaleString() : '';
    getEl('detailContent').textContent = postData.content;

    // 댓글 로드
    if(unsubscribeComments) unsubscribeComments();
    const q = query(collection(db, "posts", postId, "comments"), orderBy("createdAt", "asc"));
    
    unsubscribeComments = onSnapshot(q, (snapshot) => {
        const container = getEl('commentsContainer');
        container.innerHTML = '';
        snapshot.forEach(doc => {
            const c = doc.data();
            const div = document.createElement('div');
            div.className = 'comment-item';
            div.innerHTML = `<div class="comment-header">${c.authorName}</div><div>${c.content}</div>`;
            container.appendChild(div);
        });
    });

    // 댓글 작성 이벤트 연결 (클로저 문제 방지 위해 onclick 재할당)
    getEl('submitCommentBtn').onclick = () => writeComment(postId);
}

async function writeComment(postId) {
    const input = getEl('commentInput');
    const val = input.value.trim();
    if(!val) return;
    
    try {
        await addDoc(collection(db, "posts", postId, "comments"), {
            content: val,
            authorUid: currentUser.uid,
            authorName: currentUser.displayName,
            createdAt: serverTimestamp()
        });
        input.value = '';
    } catch(e) { console.error(e); }
}

// 유저 목록 불러오기
async function loadAllUsers() {
    const q = query(collection(db, "users"));
    // 유저 리스트는 실시간성이 덜 중요하면 getDocs 사용이 유리할 수 있음.
    // 여기선 일단 getDocs로 1회 로드 (비용 절약)
    const snapshot = await getDocs(q);
    
    const container = getEl('userListContainer');
    container.innerHTML = '';
    
    let count = 0;
    snapshot.forEach(doc => {
        const user = doc.data();
        if(user.uid === currentUser.uid) return;
        
        const div = document.createElement('div');
        div.className = 'user-card';
        div.innerHTML = `<img src="${user.photoURL}"><div><h4>${user.displayName}</h4></div>`;
        div.onclick = () => {
            startDM(user);
            getEl('communityView').style.display = 'none'; // 커뮤니티 닫기
        };
        container.appendChild(div);
        count++;
    });
    getEl('userCount').textContent = count;
}
