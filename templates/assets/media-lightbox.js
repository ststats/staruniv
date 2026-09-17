/**
 * 사진 크게 보기 · 유튜브 임베디드 플레이어 팝업. 연혁(history.js)·영상 페이지·관리자 페이지가 같이 쓴다.
 * core.js 없이도 돌아가야 한다(admin.html은 core.js를 안 싣는다).
 *
 * mediaLightboxOpen({ caption, youtubeId, image, vertical })
 *   youtubeId가 있으면 영상을, 없으면 image를 크게 띄운다. vertical이면 쇼츠처럼 세로 9:16 플레이어.
 */

function mediaLightboxEscape(str) {
    return String(str == null ? '' : str).replace(/[&<>'"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch]));
}

function mediaLightboxOpen(opts) {
    opts = opts || {};
    const yt = /^[A-Za-z0-9_-]{11}$/.test(String(opts.youtubeId || '')) ? opts.youtubeId : '';
    const img = String(opts.image || '');
    if (!yt && !img) return;
    mediaLightboxClose();
    const caption = mediaLightboxEscape(opts.caption || '');
    const layer = document.createElement('div');
    layer.className = 'media-lightbox' + (yt && opts.vertical ? ' is-vertical' : '');
    layer.id = 'media-lightbox';
    layer.setAttribute('role', 'dialog');
    layer.setAttribute('aria-modal', 'true');
    layer.setAttribute('aria-label', opts.caption || (yt ? '영상' : '사진'));
    const body = yt
        ? `<div class="media-lightbox-video"><iframe src="https://www.youtube-nocookie.com/embed/${yt}?autoplay=1&rel=0" title="${caption || 'YouTube'}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe></div>`
        : `<img class="media-lightbox-img" src="${mediaLightboxEscape(img)}" alt="${caption}">`;
    const ytLink = yt ? `<a class="media-lightbox-yt" href="https://www.youtube.com/watch?v=${yt}" target="_blank" rel="noopener">YouTube에서 보기</a>` : '';
    layer.innerHTML = `
        <div class="media-lightbox-inner">
            <div class="media-lightbox-head">
                <span class="media-lightbox-caption">${caption}</span>
                ${ytLink}
                <button type="button" class="media-lightbox-close" aria-label="닫기">✕</button>
            </div>
            ${body}
        </div>`;
    layer.addEventListener('click', e => { if (e.target === layer) mediaLightboxClose(); });
    layer.querySelector('.media-lightbox-close').addEventListener('click', mediaLightboxClose);
    document.body.appendChild(layer);
    document.body.classList.add('media-lightbox-open');
    document.addEventListener('keydown', mediaLightboxKey);
    layer.querySelector('.media-lightbox-close').focus();
}

function mediaLightboxClose() {
    const layer = document.getElementById('media-lightbox');
    if (layer) layer.remove();   // iframe을 지워야 영상 소리도 멈춘다
    document.body.classList.remove('media-lightbox-open');
    document.removeEventListener('keydown', mediaLightboxKey);
}

function mediaLightboxKey(e) {
    if (e.key === 'Escape') mediaLightboxClose();
}
