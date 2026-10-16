"""Publish source-to-implementation mappings for the local pattern editor."""
import json
from pathlib import Path

root = Path(__file__).resolve().parents[1]
path = root / 'docs/sync-box-catalog.json'
catalog = json.loads(path.read_text(encoding='utf-8-sig'))
records = []
loj = 'https://libraryofjuggling.com/Tricks/3balltricks/'
index = 'https://libraryofjuggling.com/TricksByDifficulty.html'
def add(key, name, category, status, source, note, template=None):
    row = dict(id=key, name=name, category=category, status=status, source=source, note=note)
    if template:
        row['template'] = template
    records.append(row)
    return row

for name, page, template, note in [
    ('Box', 'Box.html', 'preset:box', '通常のコラムと下の2x。'),
    ("Luke's Shuffle / Drop Box", 'Luke%27sShuffle.html', 'preset:shuffle', '上から下への2x。'),
    ('N-Box', 'N-Box.html', 'preset:n-box', 'ReverseとShuffleを交互に行う。'),
    ('Inverted Box', 'InvertedBox.html', 'preset:inverted', '上の2x。'),
    ('Switched Box', 'SwitchedBox.html', 'preset:switched', '反対側のコラムを担当する。'),
    ('Threaded Box', 'ThreadedBox.html', 'preset:underarm', 'コラムを腕の下で捕る。HFのUA全種と同一とは扱わない。'),
    ('Extended Box / Double Box', 'ExtendedBox.html', 'example:4', '中央の4xを縦に保ち、外側の4を左右交代。'),
    ('True Box / Box with a Lid', 'TrueBox.html', 'example:5', '縦上げ、高い横パス、縦下ろし、低い横パス。'),
    ('Bizarre Box', 'BizarreBox.html', 'example:10', '2Tの下へ反対の空の手を通し、投げた手自身が腕の下で捕る。次の2で運び戻してから2x。左右交代の6セット。'),
    ('Broken Box', 'BrokenBox.html', 'example:11', '両方の縦コラムを体の同じ側に置き、外側を反対の手が腕の下で扱う。左右反転で反対側へ。'),
    ('Swap Box / High-Low Box', 'SwapBox.html', 'example:3', '高い6の下で左右同時の2xを交換する。参照図と高低関係を照合。'),
    ("Karas' Box", 'Karas%27Box.html', 'example:12', '腕の下で捕る2Tと腕の下から投げる2Tで、同じ手への自己投げを往復する。'),
    ('Burst Box', 'BurstBox.html', 'example:13', '左右それぞれのBrokenを通常のBoxの横パスでつなぐ6セット。4xも球は縦に飛ぶ。'),
    ("Penman's Box", 'Penman%27sBox.html', 'example:14', '2の保持球を降下中の内側コラムの上へ回し、外側へ運んでから2xを渡す。左右交代の4セット。'),
    ('Underarm Box', 'UnderarmBox.html', 'example:15', '腕の下から4xを投げ、横パスを捕るために手を戻す。腕の下の捕球を含まない4セット。Threaded Boxと区別。'),
    ("Gilligan's Box", 'Gilligan%27sBox.html', 'example:16', '内から外へのファウンテンと腕の下の捕球。2で球を保持したまま戻り、横パスを再開する6セット。'),
    ('Levels', 'Levels.html', 'example:28', '三段のExtended Box。説明文の頂点捕球を採用。中央はクロー捕球、上段→中段→下段で受け渡す。'),
]:
    add('loj:'+page[:-5], name, '名前のある技', 'playable', loj+page, note, template)
for name, template, note in [
    ('High-Low Box', 'example:3', '6と同時2xを含む4セット。'),
    ('High-Low Inverted Box', 'example:6', '6を上から越す2xと、6の下の同時2x。'),
    ('High-Low-Around Inverted Box', 'example:8', '同時2xが飛行中の6を上下から挟む。'),
]:
    add('moore:'+name, name, 'ハイロー', 'playable', 'https://jugglingedge.com/forum.php?ThreadID=2281', note, template)
add('sync:columns3', '3球コラム / Columns', '同期パターン', 'playable', loj+'Columns.html', '(4,4)(4,0)。外側の2球と中央の1球を交互に投げる。中央は左手が担当し、反転で右手へ。', 'example:30')
add('sync:fountain4', '4球の同期ファウンテン', '同期パターン', 'playable', 'https://libraryofjuggling.com/Tricks/4balltricks/SynchFountain.html', '(4,4)。同じ手へ戻る球を内から外へ回す。', 'example:7')
for name, page, template, note in [
    ('4球コラム / Four Ball Columns', 'FourBallColumns', 'example:31', '内側の2球と外側の2球を交互に投げる。4球とも縦の軌道を保つ。内外を片側ずつ組にするPistonsと区別。'),
    ('4 ball Box', 'FourBallBox', 'example:17', '同じ向きに2回ずつパス。6は内から外へ回す。動き4セット、同じ球まで8セット。'),
    ('Stacked Box', 'FourBallStackedBox', 'example:18', '同じ縦線に8と4を重ね、両方が同時に頂点に達する。4セット。'),
    ('Synchronous Pistons', 'SynchPistons', 'example:19', '2組の同時投げが交互に並ぶ4本の縦線。位置が2セットで交代する。'),
    ('Wimpy', 'Wimpy', 'example:20', '同時の4xを少し違う高さで交差させる。動き1セット、同じ球まで4セット。'),
    ('Reverse Synchronous Fountain', 'ReverseSynchFountain', 'example:23', '逆同期ファウンテン。両手の外から内へ同時に投げ、投げた手自身で捕る。動き1セット、同じ球まで2セット。'),
]:
    add('sync:'+name, name, '同期パターン', 'playable', 'https://libraryofjuggling.com/Tricks/4balltricks/'+page+'.html', note, template)
add('loj:FourBallTakeouts', 'Four Ball Takeouts / 非同期・多重投げ', '関連技（非同期）', 'reference',
    'https://libraryofjuggling.com/Tricks/4balltricks/FourBallTakeouts.html',
    '以前のSynchronous Takeoutsという登録名を原資料に合わせて訂正。[43]23の非同期・多重投げであり、現在の同期セット列では未対応。')
basic = {'box':'preset:shower', 'box*':'preset:box', 'shuffle':'preset:shower-shuffle', 'shuffle*':'preset:shuffle', 'reverse-shuffle':'example:25', 'reverse-shuffle*':'preset:reverse', 'inverted-box':'example:26', 'inverted-box*':'preset:inverted'}
for term in catalog['source_terms']:
    template = basic.get(term['source_key'])
    status = 'components' if template else 'reference'
    note = '基本動作を編集できる。HF原動画の全局面との一致とは区別する。' if template else '原表記を保持。星印の有無を区別し、原動画との一致を照合する。'
    if term['source_key'] == 'under-arm-box*':
        status, template = 'playable', 'example:36'
        note = '腕下から4を投げ、同じ手で内側に捕る。上の2xと捕球時刻を揃える2セット。腕下で捕るThreaded Boxとは区別。実演の局面を照合し、細かな時間・奥行きの一致は未検証。'
    if term['source_key'] == 'reverse-under-arm-box*':
        status, template = 'playable', 'example:38'
        note = '下から高い位置へ2xを渡すとき、反対の手が自己投げ4を腕下で捕る。投げ側が腕下のUA-Box*とは区別。2セットで同じ球まで戻る。実演の局面を照合し、細かな時間・奥行きの一致は未検証。'
    if term['source_key'] == 'reverse-under-arm-inverted-box*':
        status, template = 'playable', 'example:45'
        note = '高い2xを下から支えて受け渡し、反対側の縦4を同じ手で腕下に捕る。4を投げた空の手は自分側へ先に戻す。2セットで同じ球まで戻る。Reverse-UA-Box*との4セット往復見本あり。実演の局面を照合し、細かな時間・奥行きの一致は未検証。'
    if term['source_key'] == 'reverse-under-arm-inverted-box':
        status, template = 'playable', 'example:47'
        note = '動画の向きでは左の高い2xと右の4xを固定。4xは体の反対側から反対の手へ横移動し、左手が右の前腕の下で捕る。動き1セット、同じ球まで3セット。通常の左2x固定Invertedとの往復は動き4セット・球識別12セット。原表の左右を反転して動画に対応。細かな寸法・奥行きの一致は未検証。'
    if term['source_key'] == 'under-arm-claw-box*':
        status, template = 'playable', 'example:40'
        note = '2xを反対の前腕の下から上げ、その手が高い位置でクロー捕球する。4は同じ手で低く捕る。左右が4と2xを交代する2セットで、同じ球まで戻る。Box Rollとの接続と、ダブル型の開始セットをずらす6セット接続の見本あり。実演の局面を照合し、細かな時間・奥行きの一致は未検証。'
    if term['source_key'] == 'under-arm-claw-box':
        status, template = 'playable', 'example:42'
        note = '左右の役割を固定。動画に合わせて左手が腕下から2xを上げ、右手がクロー捕球して4xで返す。4xの低い捕球は高い2x捕球より体の反対側に置く。動き1セット、同じ球まで3セット。細かな時間・奥行きの一致は未検証。試した他の型との接続は未成立。'
    add(term['id'], 'HF / '+term['table_name'], 'HFの18分類', status,
        term.get('video_url') or 'https://henfish.github.io/juggling-database/throws.html',
        note, template)
component_terms = {term['source_key']: term for term in catalog['source_terms']}
double_styles = {'box':'normal', 'shuffle':'shuffle', 'reverse-shuffle':'reverse', 'inverted-box':'inverted'}
for item in catalog['double_box_source_matrix']:
    status, template = 'reference', None
    note = '原表の組合せ。'+('実演動画の局面照合が必要。' if item.get('video_url') else '個別の実演動画リンクなし。')
    if item['source_key'] == 'box_box*':
        status, template = 'playable', 'preset:double-box'
        note = '同じ手が4x、4を続けて投げ、左右を交代する4セット。2xは下→下。4xは横移動するため、中央の縦線を保つExtended Boxと区別する。既存Double Boxに対応し、通常Boxとの6セット往復見本あり。原動画の局面を照合し、細かな時刻・奥行きの一致は未検証。'
    if item['source_key'] == 'box_inverted-box*':
        status, template = 'playable', 'example:50'
        note = '同じ手が4x→4を続けてから左右交代する4セット。4xと同時の2xは下→下、自己4と同時の2xは上→上。部品欄のDoubleから2種類を指定して作れる。通常Boxとの6セット往復見本あり。23枚の原動画フレームで構造を照合し、寸法・時刻の完全一致は未検証。'
    if item['source_key'] == 'shuffle_box*':
        status, template = 'playable', 'example:52'
        note = '4xと同時の2xはShuffleの上→下、自己4と同時の2xは下→下。Shuffleは下から支える手向きを明示する。4セット周期。部品欄のDoubleから作成でき、逆のBox+Shuffle型との8セット往復もある。23枚の実演フレームを照合し、細かな寸法・時刻は未検証。'
    if item['source_key'] == 'box_shuffle*':
        status, template = 'playable', 'example:53'
        note = '4xと同時の2xは下→下、自己4と同時の2xはShuffleの上→下。Shuffleは下から支える手向きを明示する。4セット周期。Shuffle+Boxと同じ部品でも配置する局面が異なる。22枚の実演フレームを照合し、細かな寸法・時刻は未検証。'
    if item['source_key'] == 'box_reverse-shuffle*':
        status, template = 'playable', 'example:55'
        note = '4xと同時の2xは下→下、自己4と同時の2xは下→上。4セットで同じ球まで戻る。Reverse同士のDoubleとの8セット往復あり。24枚の実演フレームで投げ先と高さを照合。捕球は標準設定を使い、実演の掌の細かな傾き・寸法・時刻の一致は未検証。'
    if item['source_key'] == 'reverse-shuffle_reverse-shuffle*':
        status, template = 'playable', 'example:56'
        note = '4xと自己4の両局面で、2xを下から上へ渡す4セット周期。23枚の実演フレームで投げ先と高さを照合。部品欄で2種類とも下→上にすると作れる。捕球の掌の傾きは動画から断定せず、モデルでは標準設定を採用。手向きは別に変更して検査できる。'
    if item['source_key'] == 'under-arm-claw-box_under-arm-claw-box*':
        status, template = 'playable', 'example:43'
        note = '高い投げを右4x→右4→左4x→左4の順に行い、毎セット2xを腕下からクローへ渡す。動きと同じ球が4セットで戻る。3セット目から始めると交代型の腕下クローと6セットで往復できる。低い捕球位置は単独の役割固定型と異なる。原動画の局面を照合し、細かな時間・奥行きの一致は未検証。'
    plain, star = item['plain_component'], item['star_component']
    builder = None
    if plain in double_styles and star.endswith('*') and star[:-1] in double_styles:
        builder = dict(kind='double', parts=dict(crossSet=double_styles[plain], selfSet=double_styles[star[:-1]]))
        if status == 'reference':
            status = 'components'
            note = '4xと組む2xは'+component_terms[plain]['table_name']+'、自己4と組む2xは'+component_terms[star]['table_name']+'。Double部品で4セットの候補を作れる。標準の手向きを使うため、原動画の手向き・運びとの一致は未照合。'
    row = add('hf-double:'+item['source_key'], 'HF Double / '+plain+' + '+star, 'HFの81組合せ', status,
        item.get('video_url') or 'https://henfish.github.io/juggling-database/tricks.html', note, template)
    row['component_refs'] = [component_terms[plain]['id'], component_terms[star]['id']]
    if builder:
        row['builder'] = builder
for item in catalog.get('additional_source_records', []):
    note = 'HFの公開資料にある追加項目。原動作は未照合。'
    status, template = 'reference', None
    if item['source_key'] == 'crosses*':
        status, template = 'playable', 'example:35'
        note = '実演の局面から、腕下から縦に投げて反対の手で捕る4xと、上側で保持して運ぶ2を構成。動き2セット、同じ球まで6セット。実演と秒単位の完全一致は未検証。'
    if item['source_key'] == 'older videos':
        note = '過去の実演を集めた参照動画。単一の技名として扱わない。'
    if item.get('invalid_video_reference'):
        note += ' 原資料の動画欄がURLではないため、資料一覧へリンクする。'
    add('hf-extra:'+item['source_key'], 'HF / '+item['title'], 'HFの追加資料', status,
        item.get('video_url') or 'https://henfish.github.io/juggling-database/tricks.html', note, template)
catalog['schema_version'] = 3
catalog['naming_rules']['primary_unit'] = '左右それぞれの1動作を1セットとする。4と2以外の組合せ、左右同時の2xも含む。'
catalog['naming_rules']['passing_scope'] = '本人の左右の手の受け渡しのみ。'
catalog['naming_rules']['sequence_name'] = '自由な表示名と、球数B／動きの周期S／球識別の周期C／内容IDによる構成名を分離。正確な同一性はSYNC1構造コードで比較。'
basis = [r for r in records if r['category'] == 'HFの18分類']
unresolved = [r['id'] for r in basis if r['status'] == 'reference']
combinations = [r for r in records if 'component_refs' in r]
dependency_summary = dict(basic_count=len(basis), unresolved_components=unresolved, combination_count=len(combinations),
    combinations_with_unresolved_components=sum(any(ref in unresolved for ref in r['component_refs']) for r in combinations),
    editable_basic_combinations=sum('builder' in r for r in combinations))
catalog['sequence_coverage'] = dict(records=records, dependencies=dependency_summary,
    boundary='再生あり、部品対応、資料登録を区別する。全技を網羅した一覧ではなく、参照資料を照合する対象表。', guide='sync-compose.md', browser_report='verification/sync-sequence-browser-audit.json')
path.write_text(json.dumps(catalog, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
(root/'dist/sync-catalog.json').write_text(json.dumps(catalog['sequence_coverage'], ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
print(f'Published {len(records)} reference mappings')
