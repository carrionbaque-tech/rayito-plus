// ============================================================
// ============ SISTEMA DE APOYO PAYPAL.ME ====================
// ============ Rayito Plus ===================================
// ============================================================

// ✅ Tu enlace oficial de PayPal.Me
const PAYPAL_ME_USERNAME = 'rayitoplus';

function inicializarDonaciones(auth, firestore, ipcRenderer, CONFIG_USUARIO, mostrarNotificacion) {
  const donarOverlay = document.getElementById('donar-overlay');
  const btnTopDonar = document.getElementById('top-donar');
  const cerrarDonar = document.getElementById('cerrar-donar');
  const btnDonarPaypal = document.getElementById('btn-donar-paypal');
  const inputMontoCustom = document.getElementById('donar-monto-custom');

  if (!donarOverlay || !btnTopDonar) {
    console.warn('⚠️ Elementos de apoyo no encontrados en el DOM');
    return;
  }

  let montoSeleccionado = 5;

  // ============ ABRIR MODAL ============
  btnTopDonar.addEventListener('click', () => {
    donarOverlay.classList.remove('hidden');
    const panel = donarOverlay.querySelector('.donar-panel');
    if (panel) {
      panel.style.animation = 'none';
      setTimeout(() => {
        panel.style.animation = 'popIn 0.4s cubic-bezier(0.4, 0, 0.2, 1)';
      }, 10);
    }
  });

  // ============ CERRAR MODAL ============
  if (cerrarDonar) {
    cerrarDonar.addEventListener('click', () => {
      donarOverlay.classList.add('hidden');
    });
  }

  donarOverlay.addEventListener('click', (e) => {
    if (e.target === donarOverlay) donarOverlay.classList.add('hidden');
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !donarOverlay.classList.contains('hidden')) {
      donarOverlay.classList.add('hidden');
    }
  });

  // ============ SELECCIÓN DE MONTOS ============
  document.querySelectorAll('.donar-monto').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.donar-monto').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      montoSeleccionado = parseFloat(btn.dataset.monto);
      if (inputMontoCustom) inputMontoCustom.value = '';
    });
  });

  // ============ MONTO PERSONALIZADO ============
  if (inputMontoCustom) {
    inputMontoCustom.addEventListener('input', () => {
      const val = parseFloat(inputMontoCustom.value);
      if (val && val > 0) {
        document.querySelectorAll('.donar-monto').forEach(b => b.classList.remove('active'));
        montoSeleccionado = val;
      }
    });
  }

  // ============ CONSTRUIR URL DE PAYPAL.ME ============
  // Formato: https://paypal.me/rayitoplus/5.00USD
  function construirUrlPayPalMe(monto) {
    const montoFormateado = parseFloat(monto).toFixed(2);
    return `https://paypal.me/${PAYPAL_ME_USERNAME}/${montoFormateado}USD`;
  }

  // ============ TOAST DE NOTIFICACIÓN ============
  function mostrarToastDonacion(mensaje, tipo) {
    const toast = document.createElement('div');
    toast.className = 'donar-toast';
    if (tipo === 'error') {
      toast.style.background = 'linear-gradient(135deg, #ef4444, #991b1b)';
      toast.innerHTML = '<i class="fa-solid fa-exclamation-triangle"></i> ' + mensaje;
    } else {
      toast.innerHTML = '<i class="fa-solid fa-heart"></i> ' + mensaje;
    }
    document.body.appendChild(toast);
    setTimeout(() => toast.classList.add('show'), 10);
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 400);
    }, 4000);
  }

  // ============ BOTÓN PRINCIPAL DE APOYO ============
  if (btnDonarPaypal) {
    btnDonarPaypal.addEventListener('click', async () => {
      const monto = parseFloat(montoSeleccionado);

      if (!monto || monto < 1) {
        if (inputMontoCustom) {
          inputMontoCustom.parentElement.style.borderColor = '#ef4444';
          setTimeout(() => {
            inputMontoCustom.parentElement.style.borderColor = '#2a1a3d';
          }, 1500);
        }
        mostrarToastDonacion('Monto mínimo: $1 USD', 'error');
        return;
      }

      btnDonarPaypal.disabled = true;
      const textoOriginal = btnDonarPaypal.innerHTML;
      btnDonarPaypal.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Abriendo PayPal...';

      try {
        // Registrar en Firebase (opcional)
        try {
          const user = auth.currentUser;
          if (user && firestore) {
            const { collection, addDoc, serverTimestamp } = require('firebase/firestore');
            await addDoc(collection(firestore, 'apoyos_paypal'), {
              userId: user.uid,
              email: user.email || '',
              username: user.displayName || 'Anónimo',
              monto: monto,
              moneda: 'USD',
              timestamp: serverTimestamp(),
              metodo: 'paypal.me',
              enlace: 'paypal.me/rayitoplus',
              estado: 'iniciado'
            });
          }
        } catch (e) {
          console.warn('No se pudo registrar el apoyo:', e);
        }

        // Abrir PayPal.Me en el navegador
        const urlPayPal = construirUrlPayPalMe(monto);
        console.log('🔗 Abriendo:', urlPayPal);
        await ipcRenderer.invoke('abrir-navegador', urlPayPal);

        // Mostrar agradecimiento
        mostrarToastDonacion('¡Gracias por tu apoyo! ❤️');

        // Cerrar modal
        setTimeout(() => {
          donarOverlay.classList.add('hidden');
        }, 1000);

        // Notificación del sistema
        if (CONFIG_USUARIO && CONFIG_USUARIO.notificaciones && typeof mostrarNotificacion === 'function') {
          mostrarNotificacion(
            '¡Gracias por tu apoyo! 💜',
            `Has apoyado con $${monto} USD a Rayito Plus. Tu gesto nos ayuda a seguir.`,
            'https://i.ibb.co/JRZxfPcM/ic-placeholder.jpg'
          );
        }

      } catch (err) {
        console.error('Error al abrir PayPal:', err);
        mostrarToastDonacion('No se pudo abrir PayPal. Intenta de nuevo.', 'error');
      } finally {
        btnDonarPaypal.disabled = false;
        btnDonarPaypal.innerHTML = textoOriginal;
      }
    });
  }

  console.log('💜 Sistema de apoyo PayPal.Me cargado: paypal.me/rayitoplus');
}

module.exports = { inicializarDonaciones };