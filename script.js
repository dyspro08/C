// Firebase SDK 라이브러리 가져오기 (CDN)
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-app.js";
import { getFirestore, collection, addDoc, query, orderBy, onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";

// --------------------------------------------------------------
// 1. Firebase 설정 (본인의 Firebase 콘솔 -> 프로젝트 설정에서 복사해오세요)
// --------------------------------------------------------------
const firebaseConfig = {
    apiKey: "YOUR_API_KEY",
    authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
    projectId: "YOUR_PROJECT_ID",
    storageBucket: "YOUR_PROJECT_ID.appspot.com",
    messagingSenderId: "SENDER_ID",
    appId: "APP_ID"
};

// Firebase 초기화
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// --------------------------------------------------------------
// 2. 사용자 설정 (임시)
// --------------------------------------------------------------
let username = prompt("채팅에서 사용할 닉네임을 입력하세요:", "Guest");
if (!username) username = "Anonymous";

// 사이드바에 내 이름 표시
document.getElementById('current-username').innerText = username;
document.querySelector('.user-profile .avatar').innerText = username.charAt(0).toUpperCase();

// --------------------------------------------------------------
// 3. 채팅 로직
// --------------------------------------------------------------
const messageInput = document.getElementById('message-input');
const messageContainer = document.getElementById('message-container');

// 메시지 전송 함수
async function sendMessage() {
    const text = messageInput.value.trim();
    
    if (text.length > 0) {
        try {
            await addDoc(collection(db, "messages"), {
                text: text,
                user: username,
                timestamp: serverTimestamp() // 서버 시간 기준
            });
            messageInput.value = ""; // 입력창 비우기
        } catch (e) {
            console.error("Error adding document: ", e);
            alert("메시지 전송 실패!");
        }
    }
}

// 엔터키 입력 시 전송
messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        sendMessage();
    }
});

// --------------------------------------------------------------
// 4. 실시간 데이터 수신 (onSnapshot)
// --------------------------------------------------------------
// 'messages' 컬렉션을 시간순으로 정렬하여 가져오기
const q = query(collection(db, "messages"), orderBy("timestamp", "asc"));

onSnapshot(q, (snapshot) => {
    // 기존 메시지 화면을 유지하면서, 변경사항을 처리할 수도 있지만
    // 간단한 구현을 위해 여기서는 화면을 갱신하는 방식을 씁니다.
    // (더 효율적인 방법은 docChanges()를 사용하는 것입니다)
    
    messageContainer.innerHTML = ''; // 초기화 (또는 리스트 유지하며 추가)

    // 상단 웰컴 메시지 다시 추가
    const welcomeHTML = `
        <div class="welcome-message" style="margin-bottom: 20px; border-bottom: 1px solid #4f545c; padding-bottom: 20px;">
            <h3># 일반 채널에 오신 것을 환영합니다!</h3>
            <p style="color: #b9bbbe;">이곳은 채팅의 시작점입니다.</p>
        </div>
    `;
    messageContainer.insertAdjacentHTML('beforeend', welcomeHTML);

    snapshot.forEach((doc) => {
        const msg = doc.data();
        const date = msg.timestamp ? msg.timestamp.toDate() : new Date();
        const timeString = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const initial = msg.user ? msg.user.charAt(0).toUpperCase() : '?';

        // HTML 템플릿 생성
        const messageHTML = `
            <div class="message">
                <div class="message-avatar">${initial}</div>
                <div class="message-content">
                    <div class="message-header">
                        <span class="message-username">${msg.user}</span>
                        <span class="message-timestamp">${timeString}</span>
                    </div>
                    <div class="message-text">${msg.text}</div>
                </div>
            </div>
        `;
        
        messageContainer.insertAdjacentHTML('beforeend', messageHTML);
    });

    // 스크롤을 항상 맨 아래로
    messageContainer.scrollTop = messageContainer.scrollHeight;
});
