"""전처리 파이프라인 (앱에 옮길 순서 그대로).
  1차 인식 결과(글자 상자) → 기울기 각도·글자 높이
  회전 → [영수증만 자르기] → 글자 높이 맞춰 크기 조절 → [흑백] → [톤 보정] → [선명화]
"""
import json, math, statistics, cv2, numpy as np

def first_pass_stats(raw_json):
    L = json.load(open(raw_json, encoding='utf-8'))['result']['lines']
    ang, hs = [], []
    for l in L:
        p = l['poly']
        if len(p) < 4: continue
        e1 = (p[1]['x']-p[0]['x'], p[1]['y']-p[0]['y']); e2 = (p[2]['x']-p[1]['x'], p[2]['y']-p[1]['y'])
        long_, short_ = (e1, e2) if math.hypot(*e1) >= math.hypot(*e2) else (e2, e1)
        if len(l['text']) >= 4:
            ang.append((math.degrees(math.atan2(long_[1], long_[0])) + 90) % 180 - 90)
        hs.append(math.hypot(*short_))
    return statistics.median(ang), statistics.median(hs)

def rotate(im, deg, fill):
    h, w = im.shape[:2]; M = cv2.getRotationMatrix2D((w/2, h/2), deg, 1)
    c, s = abs(M[0,0]), abs(M[0,1]); nw, nh = int(h*s + w*c), int(h*c + w*s)
    M[0,2] += nw/2 - w/2; M[1,2] += nh/2 - h/2
    return cv2.warpAffine(im, M, (nw, nh), flags=cv2.INTER_CUBIC, borderValue=fill)

def receipt_rect(im_black_fill, margin=0.02):
    hsv = cv2.cvtColor(im_black_fill, cv2.COLOR_BGR2HSV)
    mask = ((hsv[...,2] > 140) & (hsv[...,1] < 30)).astype(np.uint8) * 255
    k = max(5, im_black_fill.shape[1] // 150)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((k,k), np.uint8))
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((k*3,k*3), np.uint8))
    n, _, st, _ = cv2.connectedComponentsWithStats(mask)
    if n < 2: return None
    i = 1 + int(np.argmax(st[1:, cv2.CC_STAT_AREA])); x, y, w, h, area = st[i]
    H, Wd = mask.shape
    if area < 0.10 * H * Wd: return None
    mx, my = int(Wd*margin), int(H*margin)
    return max(0,x-mx), max(0,y-my), min(Wd,x+w+mx), min(H,y+h+my)

def run(photo, raw_json, *, rotate_on=True, crop=False, text_h=None, gray=False, tone='none', sharpen=False):
    im = cv2.imread(photo)
    ang, h0 = first_pass_stats(raw_json)
    if rotate_on:
        white = rotate(im, ang, (255,255,255))
        if crop:
            r = receipt_rect(rotate(im, ang, (0,0,0)))
            if r: white = white[r[1]:r[3], r[0]:r[2]]
        im = white
    if text_h:
        s = text_h / h0
        im = cv2.resize(im, None, fx=s, fy=s, interpolation=cv2.INTER_AREA if s < 1 else cv2.INTER_CUBIC)
        th = text_h
    else:
        th = h0
    if gray or tone == 'binarize':
        im = cv2.cvtColor(im, cv2.COLOR_BGR2GRAY)
    def on_luma(f):
        nonlocal im
        if im.ndim == 2: im = f(im)
        else:
            lab = cv2.cvtColor(im, cv2.COLOR_BGR2LAB); lab[...,0] = f(lab[...,0]); im = cv2.cvtColor(lab, cv2.COLOR_LAB2BGR)
    if tone == 'clahe':
        tile = max(2, int(round(min(im.shape[:2]) / (th * 4))))
        on_luma(lambda g: cv2.createCLAHE(2.0, (tile, tile)).apply(g))
    elif tone == 'illum':       # 그림자·구김 음영 제거: 큰 블러로 배경 밝기를 추정해 나눈다
        def illum(g):
            bg = cv2.GaussianBlur(g, (0,0), th * 1.5)
            return np.clip(g.astype(np.float32) / np.maximum(bg, 1) * 235, 0, 255).astype(np.uint8)
        on_luma(illum)
    elif tone == 'binarize':
        blk = int(th * 1.5) | 1
        im = cv2.adaptiveThreshold(im, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, blk, 10)
    if sharpen and tone != 'binarize':
        sig = max(0.8, th / 24)
        on_luma(lambda g: cv2.addWeighted(g, 1.6, cv2.GaussianBlur(g, (0,0), sig), -0.6, 0))
    return im
