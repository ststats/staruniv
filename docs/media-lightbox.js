/**
 * 사진 크게 보기 · 유튜브 임베디드 플레이어 팝업. 연혁(history.js)·영상 페이지·관리자 페이지가 같이 쓴다.
 * core.js 없이도 돌아가야 한다(admin.html은 core.js를 안 싣는다).
 *
 * mediaLightboxOpen({ caption, youtubeId, soopVodNo, image, vertical })
 *   youtubeId가 있으면 유튜브를, soopVodNo가 있으면 숲(SOOP) VOD를, 둘 다 없으면 image를 띄운다.
 *   vertical이면 쇼츠처럼 세로 9:16 플레이어.
 */

function mediaLightboxEscape(str) {
    return String(str == null ? '' : str).replace(/[&<>'"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch]));
}

function mediaLightboxOpen(opts) {
    opts = opts || {};
    const yt = /^[A-Za-z0-9_-]{11}$/.test(String(opts.youtubeId || '')) ? opts.youtubeId : '';
    // 숲 VOD 번호는 숫자뿐이다. 숫자만 받아 임베드 주소를 우리가 직접 만든다(주소를 그대로 믿지 않는다).
    const soop = !yt && /^\d{1,20}$/.test(String(opts.soopVodNo || '')) ? String(opts.soopVodNo) : '';
    const img = String(opts.image || '');
    if (!yt && !soop && !img) return;
    mediaLightboxClose();
    const caption = mediaLightboxEscape(opts.caption || '');
    const layer = document.createElement('div');
    layer.className = 'media-lightbox' + (yt && opts.vertical ? ' is-vertical' : '');
    layer.id = 'media-lightbox';
    layer.setAttribute('role', 'dialog');
    layer.setAttribute('aria-modal', 'true');
    layer.setAttribute('aria-label', opts.caption || (yt || soop ? '영상' : '사진'));
    let body;
    if (yt) {
        body = `<div class="media-lightbox-video"><iframe src="https://www.youtube-nocookie.com/embed/${yt}?autoplay=1&rel=0" title="${caption || 'YouTube'}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe></div>`;
    } else if (soop) {
        // 숲 공식 임베드. 채팅은 끄고 자동재생만 켠다(멀티뷰의 라이브 임베드와 같은 방식).
        body = `<div class="media-lightbox-video"><iframe src="https://vod.sooplive.co.kr/player/${soop}/embed?autoPlay=true&showChat=false" title="${caption || 'SOOP VOD'}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe></div>`;
    } else {
        body = `<img class="media-lightbox-img" src="${mediaLightboxEscape(img)}" alt="${caption}">`;
    }
    // 임베드가 막힌 영상은 이 링크로 원래 사이트에서 볼 수 있다.
    const outLink = yt
        ? `<a class="media-lightbox-yt" href="https://www.youtube.com/watch?v=${yt}" target="_blank" rel="noopener">YouTube에서 보기</a>`
        : (soop ? `<a class="media-lightbox-yt" href="https://vod.sooplive.co.kr/player/${soop}" target="_blank" rel="noopener">숲에서 보기</a>` : '');
    layer.innerHTML = `
        <div class="media-lightbox-inner">
            <div class="media-lightbox-head">
                <span class="media-lightbox-caption">${caption}</span>
                ${outLink}
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
