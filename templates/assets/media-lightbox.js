// 사진·유튜브·숲 VOD 팝업. 연혁·영상 페이지가 같이 쓴다.

function mediaLightboxOpen(opts) {
    opts = opts || {};
    const yt = /^[A-Za-z0-9_-]{11}$/.test(String(opts.youtubeId || '')) ? opts.youtubeId : '';
    // 받은 주소를 믿지 않고 숫자 번호로만 임베드 주소를 만든다
    const soop = !yt && /^\d{1,20}$/.test(String(opts.soopVodNo || '')) ? String(opts.soopVodNo) : '';
    const img = String(opts.image || '');
    if (!yt && !soop && !img) return;
    // 이미 열린 창에서 다시 열어도 포커스는 처음 연 버튼으로 돌려준다
    const opener = mediaLightboxOpener || document.activeElement;
    mediaLightboxClose();
    mediaLightboxOpener = opener;
    const caption = escapeHTML(opts.caption || '');
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
        body = `<div class="media-lightbox-video"><iframe src="https://vod.sooplive.co.kr/player/${soop}/embed?autoPlay=true&showChat=false" title="${caption || 'SOOP VOD'}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe></div>`;
    } else {
        body = `<img class="media-lightbox-img" src="${escapeHTML(img)}" alt="${caption}">`;
    }
    // 임베드가 막힌 영상용
    const outLink = yt
        ? `<a class="media-lightbox-yt" href="https://www.youtube.com/watch?v=${yt}" target="_blank" rel="noopener">YouTube에서 보기</a>`
        : soop
          ? `<a class="media-lightbox-yt" href="https://vod.sooplive.co.kr/player/${soop}" target="_blank" rel="noopener">숲에서 보기</a>`
          : '';
    layer.innerHTML = `
        <div class="media-lightbox-inner">
            <div class="media-lightbox-head">
                <span class="media-lightbox-caption">${caption}</span>
                ${outLink}
                <button type="button" class="media-lightbox-close" aria-label="닫기">✕</button>
            </div>
            ${body}
        </div>`;
    layer.querySelector('.media-lightbox-close').addEventListener('click', mediaLightboxClose);
    document.body.appendChild(layer);
    document.body.classList.add('media-lightbox-open');
    document.addEventListener('keydown', mediaLightboxKey);
    layer.querySelector('.media-lightbox-close').focus();
}

let mediaLightboxOpener = null;

function mediaLightboxClose() {
    const layer = document.getElementById('media-lightbox');
    if (layer) layer.remove(); // iframe을 지워야 영상 소리도 멈춘다
    document.body.classList.remove('media-lightbox-open');
    document.removeEventListener('keydown', mediaLightboxKey);
    const opener = mediaLightboxOpener;
    mediaLightboxOpener = null;
    if (layer && opener && opener.isConnected && opener.focus) opener.focus();
}

function mediaLightboxKey(e) {
    if (e.key === 'Escape') {
        mediaLightboxClose();
        return;
    }
    // 포커스 가두기
    if (e.key !== 'Tab') return;
    const layer = document.getElementById('media-lightbox');
    if (!layer) return;
    const items = [...layer.querySelectorAll('a[href], button:not([disabled]), iframe')];
    if (!items.length) return;
    const first = items[0],
        last = items[items.length - 1];
    const inside = layer.contains(document.activeElement);
    if (e.shiftKey && (document.activeElement === first || !inside)) {
        e.preventDefault();
        last.focus();
    } else if (!e.shiftKey && (document.activeElement === last || !inside)) {
        e.preventDefault();
        first.focus();
    }
}
