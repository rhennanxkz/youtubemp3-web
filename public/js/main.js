// Gerenciamento de cookies LGPD
document.addEventListener('DOMContentLoaded', function() {
    // Verificar se o usuário já consentiu com os cookies
    if (!localStorage.getItem('cookieConsent')) {
        document.getElementById('cookie-consent').classList.remove('hidden');
    }
    
    // Event listeners para os botões de consentimento
    document.getElementById('cookie-accept')?.addEventListener('click', function() {
        localStorage.setItem('cookieConsent', 'accepted');
        document.getElementById('cookie-consent').classList.add('hidden');
    });
    
    document.getElementById('cookie-reject')?.addEventListener('click', function() {
        localStorage.setItem('cookieConsent', 'rejected');
        document.getElementById('cookie-consent').classList.add('hidden');
    });
});
