import json
import tempfile
import unittest
from email.header import Header
from pathlib import Path

from thunderbird_mail import (
    BERKELEY_STORE_CONTRACT,
    MAILDIR_STORE_CONTRACT,
    ThunderbirdMailError,
    ThunderbirdSettings,
    clamp_mail_limit,
    discover_accounts,
    get_recent_mail,
    parse_profiles_ini,
    parse_profiles_ini_text,
)


class ThunderbirdFixture:
    def __init__(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.profile = self.root / 'profile'
        self.profile.mkdir()
        self.mail_root = self.profile / 'Mail' / 'school.example'
        self.mail_root.mkdir(parents=True)
        self.write_prefs()

    def close(self):
        self.temp.cleanup()

    def write_prefs(self, store_contract=BERKELEY_STORE_CONTRACT):
        directory = str(self.mail_root).replace('\\', '\\\\')
        prefs = '\n'.join([
            'user_pref("mail.account.account1.server", "server2");',
            'user_pref("mail.server.server2.hostname", "imap.example.edu");',
            'user_pref("mail.server.server2.userName", "school@example.edu");',
            'user_pref("mail.server.server2.name", "school@example.edu");',
            f'user_pref("mail.server.server2.directory", "{directory}");',
            'user_pref("mail.server.server2.directory-rel", "[ProfD]Mail/school.example");',
            'user_pref("mail.server.server2.type", "imap");',
            f'user_pref("mail.server.server2.storeContractID", "{store_contract}");',
        ])
        (self.profile / 'prefs.js').write_text(prefs + '\n', encoding='utf-8')

    def write_mbox(self, messages):
        inbox = self.mail_root / 'Inbox'
        with inbox.open('wb') as output:
            for index, message in enumerate(messages):
                output.write(f'From sender{index}@example.edu Tue Sep 15 01:10:00 2026\n'.encode())
                for key, value in message.items():
                    output.write(f'{key}: {value}\n'.encode('utf-8'))
                output.write(b'\nBody is intentionally not returned.\n')
        return inbox


class ThunderbirdMailTests(unittest.TestCase):
    def setUp(self):
        self.fixture = ThunderbirdFixture()

    def tearDown(self):
        self.fixture.close()

    def settings(self):
        return ThunderbirdSettings(profile_path=str(self.fixture.profile), account='school@example.edu')

    def test_profiles_ini_prefers_install_default_and_resolves_relative_paths(self):
        root = self.fixture.root / 'Thunderbird'
        text = '\n'.join([
            '[General]',
            'StartWithLastProfile=1',
            '[Profile0]',
            'Name=old',
            'IsRelative=1',
            'Path=Profiles/old.default',
            '[Profile1]',
            'Name=active',
            'IsRelative=1',
            'Path=Profiles/active.default-release',
            'Default=1',
            '[InstallABC]',
            'Default=Profiles/active.default-release',
        ])
        profiles = parse_profiles_ini_text(text, root)
        self.assertEqual(profiles[0].name, 'active')
        self.assertEqual(profiles[0].path, (root / 'Profiles' / 'active.default-release').resolve())

        ini = root / 'profiles.ini'
        ini.parent.mkdir(parents=True, exist_ok=True)
        ini.write_text(text, encoding='utf-8')
        self.assertEqual(parse_profiles_ini(ini)[0].name, 'active')

    def test_prefs_discover_account_without_reading_credential_prefs(self):
        accounts = discover_accounts(self.fixture.profile)
        self.assertEqual(len(accounts), 1)
        self.assertEqual(accounts[0].username, 'school@example.edu')
        self.assertEqual(accounts[0].store_contract_id, BERKELEY_STORE_CONTRACT)
        self.assertEqual(accounts[0].storage_path(self.fixture.profile), self.fixture.mail_root)

    def test_mbox_decodes_headers_sorts_and_applies_read_and_expunged_flags(self):
        encoded_subject = Header('中間発表について', 'utf-8').encode()
        encoded_sender = Header('松尾先生', 'utf-8').encode()
        self.fixture.write_mbox([
            {
                'Subject': 'Older',
                'From': 'older@example.edu',
                'Date': 'Mon, 14 Sep 2026 01:10:00 +0000',
                'Message-ID': '<older@example.edu>',
                'X-Mozilla-Status': '0001',
            },
            {
                'Subject': encoded_subject,
                'From': f'{encoded_sender} <matsuo@example.edu>',
                'Date': 'Tue, 15 Sep 2026 01:10:00 +0000',
                'Message-ID': '<newest@example.edu>',
                'X-Mozilla-Status': '0000',
            },
            {
                'Subject': 'Deleted',
                'From': 'deleted@example.edu',
                'Date': 'Wed, 16 Sep 2026 01:10:00 +0000',
                'Message-ID': '<deleted@example.edu>',
                'X-Mozilla-Status': '0008',
            },
            {
                'Subject': '   ',
                'Date': 'Wed, 13 Sep 2026 01:10:00 +0000',
                'Message-ID': '<missing-sender@example.edu>',
                'X-Mozilla-Status': '0001',
            },
        ])

        account, items = get_recent_mail(self.settings(), 5)

        self.assertEqual(account, 'sc***@example.edu')
        self.assertEqual([item.subject for item in items], ['中間発表について', 'Older', '(제목 없음)'])
        self.assertEqual(items[0].sender_name, '松尾先生')
        self.assertEqual(items[0].sender_address, 'matsuo@example.edu')
        self.assertEqual(items[0].received_at, '2026-09-15T01:10:00Z')
        self.assertFalse(items[0].is_read)
        self.assertTrue(items[1].is_read)
        self.assertEqual(items[2].sender_name, '(발신자 알 수 없음)')
        self.assertEqual(items[2].sender_address, '')
        self.assertNotIn('Deleted', [item.subject for item in items])

    def test_malformed_message_is_skipped_without_crashing(self):
        self.fixture.write_mbox([
            {
                'Subject': 'Valid',
                'From': 'valid@example.edu',
                'Date': 'Tue, 15 Sep 2026 01:10:00 +0000',
                'X-Mozilla-Status': '0000',
            },
            {
                'Subject': 'Malformed date',
                'From': 'bad@example.edu',
                'Date': 'not a date',
                'X-Mozilla-Status': '0000',
            },
        ])
        _, items = get_recent_mail(self.settings())
        self.assertEqual([item.subject for item in items], ['Valid'])

    def test_duplicate_message_ids_still_produce_unique_item_ids(self):
        self.fixture.write_mbox([
            {
                'Subject': 'First copy',
                'From': 'sender@example.edu',
                'Date': 'Tue, 15 Sep 2026 01:10:00 +0000',
                'Message-ID': '<duplicate@example.edu>',
                'X-Mozilla-Status': '0000',
            },
            {
                'Subject': 'Second copy',
                'From': 'sender@example.edu',
                'Date': 'Tue, 15 Sep 2026 01:11:00 +0000',
                'Message-ID': '<duplicate@example.edu>',
                'X-Mozilla-Status': '0000',
            },
        ])
        _, items = get_recent_mail(self.settings())
        self.assertEqual(len(items), 2)
        self.assertEqual(len({item.id for item in items}), 2)

    def test_limit_is_clamped_to_twenty(self):
        messages = []
        for index in range(25):
            messages.append({
                'Subject': f'Message {index}',
                'From': 'sender@example.edu',
                'Date': f'Tue, 15 Sep 2026 01:{index:02d}:00 +0000',
                'Message-ID': f'<message-{index}@example.edu>',
                'X-Mozilla-Status': '0000',
            })
        self.fixture.write_mbox(messages)
        _, items = get_recent_mail(self.settings(), 100)
        self.assertEqual(len(items), 20)
        self.assertEqual(clamp_mail_limit(0), 1)
        self.assertEqual(clamp_mail_limit('5'), 5)

    def test_missing_profile_and_inbox_are_safe_errors(self):
        with self.assertRaisesRegex(ThunderbirdMailError, 'profile') as profile_error:
            get_recent_mail(ThunderbirdSettings(profile_path=str(self.fixture.root / 'missing')))
        self.assertEqual(profile_error.exception.code, 'profile_not_found')

        (self.fixture.mail_root / 'Inbox').unlink(missing_ok=True)
        with self.assertRaisesRegex(ThunderbirdMailError, '받은편지함') as inbox_error:
            get_recent_mail(self.settings())
        self.assertEqual(inbox_error.exception.code, 'inbox_not_found')

    def test_unsupported_store_is_rejected(self):
        self.fixture.write_prefs(store_contract='@mozilla.org/msgstore/unknown;1')
        self.fixture.write_mbox([
            {
                'Subject': 'Unsupported',
                'From': 'sender@example.edu',
                'Date': 'Tue, 15 Sep 2026 01:10:00 +0000',
            },
        ])
        with self.assertRaisesRegex(ThunderbirdMailError, '저장 방식') as error:
            get_recent_mail(self.settings())
        self.assertEqual(error.exception.code, 'unsupported_store')

    def test_maildir_is_normalized_to_the_same_shape(self):
        self.fixture.write_prefs(store_contract=MAILDIR_STORE_CONTRACT)
        inbox = self.fixture.mail_root / 'Inbox'
        inbox.unlink(missing_ok=True)
        for folder in ('cur', 'new', 'tmp'):
            (inbox / folder).mkdir(parents=True)
        message = inbox / 'new' / 'message-1'
        message.write_text(
            'Subject: Maildir\nFrom: sender@example.edu\nDate: Tue, 15 Sep 2026 01:10:00 +0000\n\nbody\n',
            encoding='utf-8',
        )
        _, items = get_recent_mail(self.settings())
        self.assertEqual(len(items), 1)
        self.assertFalse(items[0].is_read)


if __name__ == '__main__':
    unittest.main()
