// ============================================================
// ============ SISTEMA DE CHAT COMPLETO ======================
// ============ Rayito Plus ===================================
// ============================================================

function inicializarChat(auth, db, firestore, ipcRenderer, mostrarNotificacion) {
  const { ref, get, set, push, onValue, update } = require('firebase/database');
  const { collection, addDoc, getDocs, query, where, orderBy, limit, serverTimestamp, onSnapshot, doc, updateDoc } = require('firebase/firestore');

  const chatOverlay = document.getElementById('chat-overlay');
  const cerrarChat = document.getElementById('cerrar-chat');
  const amigosLista = document.getElementById('chat-amigos-lista');
  const buscarAmigoInput = document.getElementById('chat-buscar-amigo');
  const convAvatar = document.getElementById('chat-conv-avatar');
  const convNombre = document.getElementById('chat-conv-nombre');
  const convEstado = document.getElementById('chat-conv-estado');
  const mensajesDiv = document.getElementById('chat-mensajes');
  const inputWrapper = document.getElementById('chat-input-wrapper');
  const chatInput = document.getElementById('chat-input');
  const chatSendBtn = document.getElementById('chat-send-btn');
  const stickerBtn = document.getElementById('chat-sticker-btn');
  const emojisPanel = document.getElementById('chat-emojis-panel');
  const emojisGrid = document.getElementById('chat-emojis-grid');
  const convCerrarMovil = document.getElementById('chat-conv-cerrar-movil');

  if (!chatOverlay) {
    console.warn('⚠️ Elementos de chat no encontrados');
    return;
  }

  let amigoActual = null;
  let unsubscribeMensajes = null;
  let amigosCache = [];
  let unsubscribeAmigos = null;
  let unsubscribeNotifs = null;

  // ============ EMOJIS ============
  const EMOJIS = [
    '😀','😁','😂','🤣','😃','😄','😅','😆','😉','😊','😋','😎','😍','😘','🥰','😗',
    '🤗','🤩','🤔','🤨','😐','😑','😶','🙄','😏','😣','😥','😮','🤐','😯','😪','😫',
    '🥱','😴','😌','😛','😜','🤪','🤨','🧐','🤓','😎','🥳','😏','😒','😞','😔','😟',
    '😕','🙁','☹️','😣','😖','😫','😩','🥺','😢','😭','😤','😠','😡','🤬','🤯','😳',
    '🥵','🥶','😱','😨','😰','😥','😓','🤗','🤔','🤭','🤫','🤥','😶','😐','😑','😬',
    '🙄','😯','😦','😧','😮','😲','🥱','😴','🤤','😪','😵','🤐','🥴','🤢','🤮','🤧',
    '😷','🤒','🤕','🤑','🤠','😈','👿','👹','👺','🤡','💩','👻','💀','☠️','👽','👾',
    '🤖','🎃','😺','😸','😹','😻','😼','😽','🙀','😿','😾','❤️','🧡','💛','💚','💙',
    '💜','🖤','🤍','🤎','💔','❣️','💕','💞','💓','💗','💖','💘','💝','💟','👍','👎',
    '👌','✌️','🤞','🤟','🤘','🤙','👈','👉','👆','👇','☝️','✋','🤚','🖐','🖖','👋'
  ];

  function renderEmojis() {
    emojisGrid.innerHTML = EMOJIS.map(e => 
      `<button class="chat-emoji" data-emoji="${e}">${e}</button>`
    ).join('');
    emojisGrid.querySelectorAll('.chat-emoji').forEach(btn => {
      btn.addEventListener('click', () => {
        chatInput.value += btn.dataset.emoji;
        chatInput.focus();
      });
    });
  }

  stickerBtn.addEventListener('click', () => {
    emojisPanel.classList.toggle('hidden');
    if (!emojisGrid.innerHTML) renderEmojis();
  });

  // ============ ABRIR CHAT ============
  function abrirChat() {
    chatOverlay.classList.remove('hidden');
    cargarAmigos();
  }

  // ✅ Exponer también función para abrir chat DIRECTO con un amigo
  window.abrirChatConAmigo = async function (amigoId) {
    chatOverlay.classList.remove('hidden');
    await cargarAmigos();
    const amigo = amigosCache.find(a => a.id === amigoId);
    if (amigo) {
      setTimeout(() => abrirConversacion(amigo), 100);
    }
  };

  cerrarChat.addEventListener('click', () => {
    chatOverlay.classList.add('hidden');
    if (unsubscribeMensajes) { unsubscribeMensajes(); unsubscribeMensajes = null; }
  });

  chatOverlay.addEventListener('click', (e) => {
    if (e.target === chatOverlay) {
      chatOverlay.classList.add('hidden');
      if (unsubscribeMensajes) { unsubscribeMensajes(); unsubscribeMensajes = null; }
    }
    if (!emojisPanel.contains(e.target) && e.target !== stickerBtn && !stickerBtn.contains(e.target)) {
      emojisPanel.classList.add('hidden');
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !chatOverlay.classList.contains('hidden')) {
      chatOverlay.classList.add('hidden');
      if (unsubscribeMensajes) { unsubscribeMensajes(); unsubscribeMensajes = null; }
    }
  });

  if (convCerrarMovil) {
    convCerrarMovil.addEventListener('click', () => {
      document.querySelector('.chat-conversacion').classList.remove('activo');
    });
  }

  async function cargarAmigos() {
  const user = auth.currentUser;
  if (!user) return;

  amigosLista.innerHTML = '<p class="chat-empty">Cargando amigos...</p>';
  amigosCache = [];

  try {
    // PASO 1: Leer friends/{userId}
    const snapshot = await get(ref(db, 'friends/' + user.uid));
    const amigosIds = [];

    if (snapshot.exists()) {
      const data = snapshot.val();
      for (const k in data) {
        if (data[k] === true || data[k] === 'true') {
          amigosIds.push(k);
        }
      }
    }

    if (amigosIds.length === 0) {
      amigosLista.innerHTML = '<p class="chat-empty">No tienes amigos aún.</p>';
      return;
    }

    // ═══════════════════════════════════════════════════════
    // ✅ OPTIMIZACIÓN: Cargar TODOS los usuarios en PARALELO
    // ═══════════════════════════════════════════════════════
    const usersPromises = amigosIds.map(id =>
      get(ref(db, 'users/' + id))
        .then(snap => snap.exists() ? { id, ...snap.val() } : null)
        .catch(() => null)
    );

    const usersData = (await Promise.all(usersPromises)).filter(Boolean);

    // ═══════════════════════════════════════════════════════
    // ✅ OPTIMIZACIÓN: Cargar TODOS los últimos mensajes en PARALELO
    // ═══════════════════════════════════════════════════════
    const messagesPromises = usersData.map(async (u) => {
      try {
        const chatId = [user.uid, u.id].sort().join('_');
        const mensajesRef = collection(firestore, 'chats', chatId, 'messages');
        const q = query(mensajesRef, orderBy('timestamp', 'desc'), limit(1));
        const snap = await getDocs(q);

        let lastMessage = 'Sin mensajes';
        let lastMessageTime = 0;
        let unreadCount = 0;

        if (!snap.empty) {
          const ultimo = snap.docs[0].data();
          lastMessage = ultimo.message || ultimo.text || '';
          lastMessageTime = ultimo.timestamp || 0;

          // Contar no leídos
          try {
            const noLeidosQuery = query(
              mensajesRef,
              where('senderId', '==', u.id),
              where('status', 'in', ['sent', 'delivered'])
            );
            const noLeidosSnap = await getDocs(noLeidosQuery);
            unreadCount = noLeidosSnap.size;
          } catch (e) {
            unreadCount = 0;
          }
        }

        return {
          id: u.id,
          name: u.username || u.name || 'Usuario',
          photo: u.photoBase64 || u.photoURL || u.profileImageUrl || 'https://i.ibb.co/JRZxfPcM/ic-placeholder.jpg',
          lastMessage,
          lastMessageTime,
          unreadCount,
          online: u.online || false
        };
      } catch (e) {
        return {
          id: u.id,
          name: u.username || u.name || 'Usuario',
          photo: u.photoBase64 || u.photoURL || 'https://i.ibb.co/JRZxfPcM/ic-placeholder.jpg',
          lastMessage: 'Sin mensajes',
          lastMessageTime: 0,
          unreadCount: 0,
          online: u.online || false
        };
      }
    });

    amigosCache = await Promise.all(messagesPromises);

    // Ordenar
    amigosCache.sort((a, b) => (b.lastMessageTime || 0) - (a.lastMessageTime || 0));

    renderAmigos(amigosCache);
    escucharCambiosAmigos(user.uid);

  } catch (err) {
    console.error('Error cargando amigos:', err);
    amigosLista.innerHTML = '<p class="chat-empty">Error al cargar amigos: ' + (err.message || 'desconocido') + '</p>';
  }
}

  function renderAmigos(amigos) {
    if (amigos.length === 0) {
      amigosLista.innerHTML = '<p class="chat-empty">No tienes amigos aún. Ve a Cuenta → Mis Amigos y agrega a alguien.</p>';
      return;
    }

    amigosLista.innerHTML = amigos.map(a => {
      let preview = a.lastMessage || 'Sin mensajes';
      if (preview.startsWith('[STICKER:')) preview = '🖼️ Sticker';
      if (preview.length > 40) preview = preview.substring(0, 40) + '...';

      return `
        <div class="chat-amigo-item ${amigoActual?.id === a.id ? 'active' : ''}" data-id="${a.id}">
          <img src="${a.photo}" class="chat-amigo-avatar" onerror="this.src='https://i.ibb.co/JRZxfPcM/ic-placeholder.jpg'">
          <div class="chat-amigo-info">
            <h4>${escapeHtml(a.name)}</h4>
            <p>${escapeHtml(preview)}</p>
          </div>
          ${a.unreadCount > 0 ? `<span class="chat-amigo-badge">${a.unreadCount > 99 ? '99+' : a.unreadCount}</span>` : ''}
        </div>
      `;
    }).join('');

    amigosLista.querySelectorAll('.chat-amigo-item').forEach(item => {
      item.addEventListener('click', () => {
        const amigo = amigosCache.find(a => a.id === item.dataset.id);
        if (amigo) abrirConversacion(amigo);
      });
    });
  }

  // ============ BUSCAR AMIGO ============
  buscarAmigoInput.addEventListener('input', (e) => {
    const q = e.target.value.trim().toLowerCase();
    if (!q) {
      renderAmigos(amigosCache);
      return;
    }
    const filtrados = amigosCache.filter(a => 
      a.name.toLowerCase().includes(q)
    );
    renderAmigos(filtrados);
  });

  // ============ ABRIR CONVERSACIÓN ============
  async function abrirConversacion(amigo) {
    amigoActual = amigo;

    amigosLista.querySelectorAll('.chat-amigo-item').forEach(item => {
      item.classList.toggle('active', item.dataset.id === amigo.id);
    });

    const convEl = document.querySelector('.chat-conversacion');
    if (convEl) convEl.classList.add('activo');

    convAvatar.src = amigo.photo;
    convNombre.textContent = amigo.name;
    convEstado.textContent = amigo.online ? 'En línea' : 'Desconectado';
    convEstado.style.color = amigo.online ? '#10b981' : '#6b7280';
    inputWrapper.classList.remove('hidden');

    cargarMensajes(amigo.id);
    marcarComoLeido(amigo.id);
  }

  // ============================================================
  // ============ CARGAR MENSAJES ===============================
  // ============================================================
  function cargarMensajes(amigoId) {
    const user = auth.currentUser;
    if (!user) return;

    if (unsubscribeMensajes) { unsubscribeMensajes(); unsubscribeMensajes = null; }

    mensajesDiv.innerHTML = '<p class="chat-empty">Cargando mensajes...</p>';

    const chatId = [user.uid, amigoId].sort().join('_');
    const mensajesRef = collection(firestore, 'chats', chatId, 'messages');

    unsubscribeMensajes = onSnapshot(mensajesRef, (snapshot) => {
      const mensajes = [];
      snapshot.forEach(doc => {
        mensajes.push({ id: doc.id, ...doc.data() });
      });

      mensajes.sort((a, b) => {
        const tA = a.timestamp?.toDate ? a.timestamp.toDate().getTime() : (a.timestamp || 0);
        const tB = b.timestamp?.toDate ? b.timestamp.toDate().getTime() : (b.timestamp || 0);
        return tA - tB;
      });

      renderMensajes(mensajes, user.uid);

      // Marcar como leídos los mensajes del otro usuario
      snapshot.forEach(async (d) => {
        const m = d.data();
        if (m.senderId === amigoId && m.status !== 'read') {
          try {
            await updateDoc(d.ref, { status: 'read' });
          } catch (e) {}
        }
      });
    }, (err) => {
      console.warn('Error escuchando mensajes:', err);
      renderMensajes([], user.uid);
    });
  }

  function renderMensajes(mensajes, miId) {
    if (mensajes.length === 0) {
      mensajesDiv.innerHTML = `
        <div class="chat-empty-grande">
          <i class="fa-solid fa-comment-dots"></i>
          <h3>Sin mensajes</h3>
          <p>Envía el primero para romper el hielo 🧊</p>
        </div>
      `;
      return;
    }

    mensajesDiv.innerHTML = mensajes.map(m => {
      const esMio = m.senderId === miId || m.userId === miId;
      
      let fecha = 'Ahora';
      if (m.formattedTime) {
        fecha = m.formattedTime;
      } else if (m.timestamp?.toDate) {
        fecha = m.timestamp.toDate().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
      } else if (typeof m.timestamp === 'number') {
        fecha = new Date(m.timestamp).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
      }

      let contenido = m.text || m.message || '';
      if (contenido.startsWith('[STICKER:')) {
        contenido = '🖼️ Sticker';
      }

      return `
        <div class="chat-burbuja ${esMio ? 'yo' : 'otro'}">
          <div class="chat-burbuja-texto">${escapeHtml(contenido)}</div>
          <div class="chat-burbuja-fecha">${fecha}</div>
        </div>
      `;
    }).join('');

    setTimeout(() => {
      mensajesDiv.scrollTop = mensajesDiv.scrollHeight;
    }, 50);
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // ============================================================
  // ============ ENVIAR MENSAJE ================================
  // ============================================================
  async function enviarMensaje() {
    const user = auth.currentUser;
    if (!user || !amigoActual) return;

    const texto = chatInput.value.trim();
    if (!texto) return;

    chatInput.value = '';
    chatInput.focus();

    const chatId = [user.uid, amigoActual.id].sort().join('_');

    try {
      const ahora = Date.now();
      const fecha = new Date(ahora);

      await addDoc(collection(firestore, 'chats', chatId, 'messages'), {
        senderId: user.uid,
        senderName: user.displayName || 'Usuario',
        senderPhoto: user.photoURL || '',
        message: texto,
        text: texto,
        timestamp: ahora,
        formattedDate: fecha.toLocaleDateString('es-ES'),
        formattedTime: fecha.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }),
        status: 'sent',
        deleted: false
      });

      // Actualizar lista local sin esperar a que se recargue todo
      const amigo = amigosCache.find(a => a.id === amigoActual.id);
      if (amigo) {
        amigo.lastMessage = texto;
        amigo.lastMessageTime = ahora;
        amigosCache.sort((a, b) => (b.lastMessageTime || 0) - (a.lastMessageTime || 0));
        renderAmigos(amigosCache);
      }

      // Actualizar metadata propia
      try {
        await set(ref(db, `conversations/${user.uid}/friends/${amigoActual.id}`), {
          friendId: amigoActual.id,
          friendName: amigoActual.name,
          lastMessage: texto,
          lastMessageTime: Date.now(),
          unreadCount: 0
        });
      } catch (e) {}

      // Crear notificación para el destinatario (esto permite que le llegue la noti)
      try {
        await addDoc(collection(firestore, 'user_notifications', amigoActual.id, 'notifications'), {
          titulo: `💬 ${user.displayName || 'Nuevo mensaje'}`,
          mensaje: texto.substring(0, 80),
          tipo: 'chat',
          deUserId: user.uid,
          deUserName: user.displayName || 'Usuario',
          deUserPhoto: user.photoURL || '',
          chatId: chatId,
          timestamp: serverTimestamp(),
          leida: false,
          read: false
        });
      } catch (e) {
        console.warn('No se pudo crear notificación:', e.message);
      }

    } catch (err) {
      console.error('Error enviando mensaje:', err);
      alert('No se pudo enviar el mensaje: ' + err.message);
    }
  }

  chatSendBtn.addEventListener('click', enviarMensaje);
  chatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') enviarMensaje();
  });

  // ============ MARCAR COMO LEÍDO ============
  async function marcarComoLeido(amigoId) {
    const user = auth.currentUser;
    if (!user) return;
    try {
      await set(ref(db, `conversations/${user.uid}/friends/${amigoId}/unreadCount`), 0);
      const amigo = amigosCache.find(a => a.id === amigoId);
      if (amigo) {
        amigo.unreadCount = 0;
        renderAmigos(amigosCache);
      }
    } catch (e) {}
  }

  // ============================================================
  // ============ ESCUCHAR NUEVOS MENSAJES EN TIEMPO REAL =======
  // Detecta mensajes nuevos y muestra notificación
  // ============================================================
  function escucharCambiosAmigos(userId) {
    if (unsubscribeAmigos) { unsubscribeAmigos(); unsubscribeAmigos = null; }

    // Escuchar metadata de conversaciones (último mensaje, unread)
    try {
      const convRef = ref(db, `conversations/${userId}/friends`);
      unsubscribeAmigos = onValue(convRef, (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.val();
          for (const friendId in data) {
            const amigo = amigosCache.find(a => a.id === friendId);
            if (amigo) {
              if (data[friendId].lastMessage) {
                amigo.lastMessage = data[friendId].lastMessage;
              }
              amigo.lastMessageTime = data[friendId].lastMessageTime || amigo.lastMessageTime;
              amigo.unreadCount = data[friendId].unreadCount || amigo.unreadCount;
            }
          }
          amigosCache.sort((a, b) => (b.lastMessageTime || 0) - (a.lastMessageTime || 0));
          renderAmigos(amigosCache);
        }
      });
    } catch (e) {
      console.warn('No se pudo escuchar conversaciones:', e.message);
    }

    // Escuchar notificaciones propias para detectar mensajes nuevos
    if (unsubscribeNotifs) { unsubscribeNotifs(); unsubscribeNotifs = null; }
    try {
      const notifRef = collection(firestore, 'user_notifications', userId, 'notifications');
      let primeraCarga = true;

      unsubscribeNotifs = onSnapshot(notifRef, (snapshot) => {
        if (primeraCarga) {
          primeraCarga = false;
          return;
        }

        snapshot.docChanges().forEach(async (change) => {
          if (change.type === 'added') {
            const notif = change.doc.data();

            // Solo notificaciones de chat nuevas
            if (notif.tipo === 'chat' && !notif.leida) {
              // Mostrar notificación nativa
              if (typeof mostrarNotificacion === 'function') {
                mostrarNotificacion(
                  notif.titulo || '💬 Nuevo mensaje',
                  notif.mensaje || '',
                  notif.deUserPhoto || 'https://i.ibb.co/JRZxfPcM/ic-placeholder.jpg'
                );
              }

              // Actualizar badge y lista local
              const amigo = amigosCache.find(a => a.id === notif.deUserId);
              if (amigo) {
                amigo.lastMessage = notif.mensaje || '';
                amigo.lastMessageTime = Date.now();
                amigo.unreadCount = (amigo.unreadCount || 0) + 1;
                amigosCache.sort((a, b) => (b.lastMessageTime || 0) - (a.lastMessageTime || 0));
                renderAmigos(amigosCache);
              } else {
                // Es un amigo nuevo, recargar
                cargarAmigos();
              }
            }
          }
        });
      });
    } catch (e) {
      console.warn('No se pudo escuchar notificaciones:', e.message);
    }
  }

  // ============ EXPONER FUNCIONES ============
  window.abrirChatRayito = abrirChat;

  console.log('💬 Sistema de chat cargado correctamente');
}

module.exports = { inicializarChat };