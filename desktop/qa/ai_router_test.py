"""No live AI traffic. Accept an optional path to the unpacked candidate's scripts."""
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

SCRIPTS = Path(sys.argv.pop(1)) if len(sys.argv) > 1 else Path(__file__).resolve().parents[1] / 'scripts'
sys.path.insert(0, str(SCRIPTS))
from providers import ai_router, secret_store, news_briefing, channels
from providers.ai_trader import AiTraderService, TOOL_GATE_MAP

HOSTS = {
    'gemini': 'https://generativelanguage.googleapis.com/',
    'deepseek': 'https://api.deepseek.com/',
    'claude': 'https://api.anthropic.com/',
    'openai': 'https://api.openai.com/',
}


def response(provider, body):
    text = json.dumps(body, ensure_ascii=False)
    if provider == 'gemini':
        return {'candidates': [{'content': {'parts': [{'text': text}]}}]}
    if provider == 'claude':
        return {'content': [{'type': 'text', 'text': text}]}
    return {'choices': [{'message': {'content': text}}]}


class AiAcceptance(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        self.keys = {name: f'qa-{name}-credential-only' for name in HOSTS}
        self.paid = patch.object(ai_router, '_post')
        self.post = self.paid.start()
        self.addCleanup(self.paid.stop)

    def configure(self, name, **changes):
        return ai_router.update_settings(self.root, {'provider': name, **changes})

    def test_four_routes_and_key_isolation(self):
        secret_store.set_gemini_api_key(self.root, self.keys['gemini'])
        for name, host in HOSTS.items():
            model = 'qa-model-' + name
            state = self.configure(name, models={name: model}, keys={name: self.keys[name]})
            self.assertTrue(state['keys'][name])
            self.assertNotIn(self.keys[name], json.dumps(state))
            self.post.return_value = response(name, {'answer': 'ok'})
            self.assertEqual(ai_router.session(self.root, 'briefing').generate('qa'), {'answer': 'ok'})
            url, headers, payload, _ = self.post.call_args.args
            self.assertTrue(url.startswith(host), url)
            self.assertIn(self.keys[name], ' '.join(headers.values()))
            for other in self.keys.keys() - {name}:
                self.assertNotIn(self.keys[other], ' '.join(headers.values()))
            self.assertIn(model, url if name == 'gemini' else payload['model'])

        disk = json.loads(secret_store._secrets_file(self.root).read_text(encoding='utf-8'))
        if os.name == 'nt':
            self.assertEqual(disk['encoding'], 'dpapi-v1')
            self.assertEqual(len(set(disk['secrets'].values())), 4)
        self.assertFalse(any(key in json.dumps(disk) for key in self.keys.values()))
        self.configure('claude', keys={'claude': None})
        self.assertEqual(ai_router.session(self.root, 'trader').status, 'missing_key')
        self.assertEqual(secret_store.get_gemini_api_key(self.root), self.keys['gemini'])
        self.assertEqual(secret_store.get_ai_key(self.root, 'openai'), self.keys['openai'])

    def test_legacy_gemini_key_and_module_switches(self):
        path = self.root / 'user-v1' / 'briefing-secrets.json'
        path.parent.mkdir()
        path.write_text(json.dumps({'geminiApiKey': self.keys['gemini']}), encoding='utf-8')
        self.assertTrue(ai_router.public_state(self.root)['keys']['gemini'])
        self.assertFalse(path.exists())
        pending = ai_router.session(self.root, 'briefing')
        self.configure('gemini', enabled=False)
        for feature in ai_router.FEATURES:
            sel = ai_router.session(self.root, feature)
            self.assertEqual(sel.status, 'disabled')
            with self.assertRaises(RuntimeError):
                sel.generate('qa')
        with self.assertRaises(RuntimeError):
            pending.generate('qa')
        self.configure('gemini', enabled=True, features={name: False for name in ai_router.FEATURES})
        for feature in ai_router.FEATURES:
            sel = ai_router.session(self.root, feature)
            self.assertEqual(sel.status, 'feature_disabled')
            with self.assertRaises(RuntimeError):
                sel.generate('qa')
        self.post.assert_not_called()

    def test_briefing_success_failure_and_local_mode(self):
        self.configure('openai', keys={'openai': self.keys['openai']})
        briefing = news_briefing.BriefingService(self.root, self.root)
        self.post.return_value = response('openai', {'summary': ['固定摘要'],
                                                     'sectors': ['輪動'], 'watchPoints': ['觀察'], 'risks': ['風險']})
        with patch.object(briefing, '_query_windows_task', return_value='QA'), \
             patch.object(news_briefing, '_fetch_yahoo_quote', return_value=None), \
             patch.object(news_briefing, '_fetch_news_pool', return_value=([], [])), \
             patch.object(briefing, '_fetch_tracked_quotes', return_value=[]), \
             patch.object(briefing, '_extract_news_stocks', return_value=[]):
            report = briefing.generate()
            self.assertEqual(report['ai']['status'], 'success')
            self.assertEqual(report['analysis']['risks'], ['風險'])
            self.post.side_effect = RuntimeError('mock failure')
            self.assertEqual(briefing.generate()['ai']['status'], 'failed')
            self.post.reset_mock(side_effect=True)
            self.configure('openai', features={'briefing': False})
            self.assertEqual(briefing.generate()['ai']['status'], 'feature_disabled')
            self.post.assert_not_called()

    def test_channel_success_video_capability_and_fallback(self):
        self.configure('claude', keys={'claude': self.keys['claude'], 'gemini': self.keys['gemini']})
        service = channels.ChannelService(self.root, self.root)
        vid = 'aBcDeF12345'
        video = {'videoId': vid, 'title': '台股市場測試', 'url': f'https://www.youtube.com/watch?v={vid}',
                 'description': '', 'publishedAt': '2026-11-27'}
        meta = dict(durationSec=30, description='', isLiveNow=False, keywords=[], category='',
                    watchTracks=[], innertubeCache={})
        base = {'coreThesis': '資料核對', 'summaryBullets': [{'timeSec': 2, 'text': '符合來源'}],
                'crossChecks': ['集保日期與影片時點不同，待核']}
        with patch.object(service, '_fetch_video_metadata', return_value=meta), \
             patch.object(service, '_evaluate_finance_relevance', return_value='pass'), \
             patch.object(service, '_fetch_video_captions', return_value=[(2, '固定字幕')]) as caps:
            self.post.return_value = response('claude', base)
            strategy = service._analyze_video(video, '測試')[2]
            self.assertEqual(strategy['ai']['status'], 'success')
            self.assertEqual(strategy['analysis']['crossChecks'], base['crossChecks'])
            self.post.side_effect = RuntimeError('mock failure')
            strategy = service._analyze_video(video, '測試')[2]
            self.assertEqual(strategy['ai']['status'], 'failed')
            self.assertEqual(strategy['sourceMode'], 'cc_rule')
            self.post.reset_mock(side_effect=True)
            caps.return_value = []
            status, message, strategy, _ = service._analyze_video(video, '測試')
            self.assertEqual(status, 'waiting_subtitles')
            self.assertIn('不支援', message)
            self.post.assert_not_called()
            self.configure('gemini')
            self.post.return_value = response('gemini', base)
            strategy = service._analyze_video(video, '測試')[2]
            self.assertEqual(strategy['ai']['status'], 'success')
            self.assertEqual(strategy['sourceMode'], 'video_ai')
            self.assertEqual(self.post.call_args.args[2]['contents'][0]['parts'][0]['fileData']['fileUri'], video['url'])

    def test_trader_structured_decision_and_rule_fallback(self):
        self.configure('deepseek', keys={'deepseek': self.keys['deepseek']})
        paper = Mock()
        paper.load_slot.return_value = {'market': 'TW', 'currency': 'TWD',
                                       'aiConfig': {'tools': {key: False for key in TOOL_GATE_MAP.values()}}}
        service = AiTraderService(self.root, self.root, paper)
        with patch.object(service, '_get_fx_rate', return_value=32), \
             patch.object(service, 'enforce_guardrails', return_value=([], [])) as guard, \
             patch.object(service, '_run_rule_fallback', return_value={'summary': '本機觀望', 'actions': []}):
            self.post.return_value = response('deepseek', {
                'summary': '模擬觀望', 'actions': [], 'evidence': ['資料不足'], 'riskPlan': ['保留現金'],
            })
            log = service.run_decision('qa-slot', force=True)['log']
            self.assertEqual(log['ai']['status'], 'success')
            self.assertEqual(log['analysis']['riskPlan'], ['保留現金'])
            guard.assert_called()
            paper.place_order.assert_not_called()
            self.post.return_value = response('deepseek', {'summary': '缺操作欄位'})
            log = service.run_decision('qa-slot', force=True)['log']
            self.assertEqual(log['ai']['status'], 'failed')
            self.assertEqual(log['engineMode'], 'rule_fallback')
            self.post.reset_mock()
            self.configure('deepseek', features={'trader': False})
            self.assertEqual(service.run_decision('qa-slot', force=True)['log']['ai']['status'], 'feature_disabled')
            self.post.assert_not_called()


if __name__ == '__main__':
    unittest.main(verbosity=2)
