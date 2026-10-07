import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import thunderbird_send
from thunderbird_mail import ThunderbirdMailItem, ThunderbirdMailMessage, ThunderbirdSettings
from thunderbird_send import (
    ThunderbirdSendError,
    get_smtp_status,
    preview_mail,
    send_confirmed_mail,
)


class ThunderbirdSendFixture:
    def __init__(self, auth_method=3, socket_type=3):
        self.temp = tempfile.TemporaryDirectory()
        self.profile = Path(self.temp.name) / 'profile'
        self.profile.mkdir(parents=True)
        mail_root = self.profile / 'Mail' / 'school.example'
        mail_root.mkdir(parents=True)
        directory = str(mail_root).replace('\\', '\\\\')
        prefs = '\n'.join([
            'user_pref("mail.account.account1.server", "server2");',
            'user_pref("mail.account.account1.identities", "id1");',
            'user_pref("mail.server.server2.hostname", "imap.example.edu");',
            'user_pref("mail.server.server2.userName", "school@example.edu");',
            'user_pref("mail.server.server2.name", "School Account");',
            f'user_pref("mail.server.server2.directory", "{directory}");',
            'user_pref("mail.server.server2.directory-rel", "[ProfD]Mail/school.example");',
            'user_pref("mail.server.server2.type", "imap");',
            'user_pref("mail.identity.id1.useremail", "school@example.edu");',
            'user_pref("mail.identity.id1.fullName", "Student Name");',
            'user_pref("mail.identity.id1.smtpServer", "smtp1");',
            'user_pref("mail.smtp.defaultserver", "smtp1");',
            'user_pref("mail.smtpserver.smtp1.hostname", "smtp.example.edu");',
            'user_pref("mail.smtpserver.smtp1.username", "school@example.edu");',
            'user_pref("mail.smtpserver.smtp1.port", 587);',
            f'user_pref("mail.smtpserver.smtp1.socketType", {socket_type});',
            f'user_pref("mail.smtpserver.smtp1.authMethod", {auth_method});',
        ])
        (self.profile / 'prefs.js').write_text(prefs + '\n', encoding='utf-8')

    def settings(self):
        return ThunderbirdSettings(
            profile_path=str(self.profile),
            account='school@example.edu',
        )

    def close(self):
        self.temp.cleanup()


class ThunderbirdSendTests(unittest.TestCase):
    def setUp(self):
        self.fixture = ThunderbirdSendFixture()
        thunderbird_send._PREVIEWS.clear()

    def tearDown(self):
        thunderbird_send._PREVIEWS.clear()
        self.fixture.close()

    def test_status_discovers_non_secret_thunderbird_smtp_settings(self):
        with patch.dict(os.environ, {'THUNDERBIRD_SMTP_PASSWORD': ''}, clear=False):
            result = get_smtp_status(self.fixture.settings())
        self.assertEqual(result['smtp']['host'], 'smtp.example.edu')
        self.assertEqual(result['smtp']['port'], 587)
        self.assertEqual(result['smtp']['security'], 'starttls')
        self.assertEqual(result['smtp']['authMethod'], 3)
        self.assertEqual(result['smtp']['username'], 'sc***@example.edu')
        self.assertFalse(result['smtp']['passwordConfigured'])
        self.assertFalse(result['smtp']['ready'])

    def test_preview_creates_one_time_confirmation_without_sending(self):
        with patch.dict(os.environ, {'THUNDERBIRD_SMTP_PASSWORD': 'secret'}, clear=False), patch('thunderbird_send.smtplib.SMTP') as smtp:
            result = preview_mail(self.fixture.settings(), {
                'to': 'teacher@example.edu',
                'subject': 'Test subject',
                'body': 'Hello',
            })
        smtp.assert_not_called()
        self.assertEqual(result['preview']['from'], 'school@example.edu')
        self.assertEqual(result['preview']['to'], 'teacher@example.edu')
        self.assertTrue(result['confirmationToken'])
        self.assertTrue(result['smtp']['ready'])

    def test_confirmed_send_uses_starttls_login_and_standard_headers(self):
        with patch.dict(os.environ, {'THUNDERBIRD_SMTP_PASSWORD': 'secret'}, clear=False):
            preview = preview_mail(self.fixture.settings(), {
                'to': 'teacher@example.edu',
                'subject': 'Test subject',
                'body': 'Hello',
            })
            with patch('thunderbird_send.smtplib.SMTP') as smtp_class:
                client = smtp_class.return_value.__enter__.return_value
                result = send_confirmed_mail(self.fixture.settings(), {
                    'to': 'teacher@example.edu',
                    'subject': 'Test subject',
                    'body': 'Hello',
                    'confirmationToken': preview['confirmationToken'],
                })

        smtp_class.assert_called_once_with('smtp.example.edu', 587, timeout=20)
        client.starttls.assert_called_once()
        client.login.assert_called_once_with('school@example.edu', 'secret')
        client.send_message.assert_called_once()
        message = client.send_message.call_args.args[0]
        self.assertEqual(message['To'], 'teacher@example.edu')
        self.assertEqual(message['Subject'], 'Test subject')
        self.assertTrue(message['Date'])
        self.assertTrue(message['Message-ID'])
        self.assertEqual(result['sent']['to'], 'te***@example.edu')

    def test_confirmation_rejects_changed_message_and_is_one_time(self):
        with patch.dict(os.environ, {'THUNDERBIRD_SMTP_PASSWORD': 'secret'}, clear=False):
            preview = preview_mail(self.fixture.settings(), {
                'to': 'teacher@example.edu',
                'subject': 'Original',
                'body': 'Hello',
            })
            with self.assertRaises(ThunderbirdSendError) as mismatch:
                send_confirmed_mail(self.fixture.settings(), {
                    'to': 'teacher@example.edu',
                    'subject': 'Changed',
                    'body': 'Hello',
                    'confirmationToken': preview['confirmationToken'],
                })
            self.assertEqual(mismatch.exception.code, 'confirmation_mismatch')

            with self.assertRaises(ThunderbirdSendError) as reused:
                send_confirmed_mail(self.fixture.settings(), {
                    'to': 'teacher@example.edu',
                    'subject': 'Original',
                    'body': 'Hello',
                    'confirmationToken': preview['confirmationToken'],
                })
            self.assertEqual(reused.exception.code, 'confirmation_expired')

    def test_reply_preview_derives_recipient_subject_and_thread_headers(self):
        source = ThunderbirdMailMessage(
            item=ThunderbirdMailItem(
                id='abc',
                subject='Meeting',
                sender_name='Teacher',
                sender_address='teacher@example.edu',
                received_at='2026-10-07T00:00:00Z',
                is_read=True,
                message_id='<original@example.edu>',
            ),
            body='Original',
        )
        with patch('thunderbird_send.get_mail_message', return_value=('sc***@example.edu', source)):
            preview = preview_mail(self.fixture.settings(), {
                'replyToMailId': 'abc',
                'folder': 'inbox',
                'body': 'Reply body',
            })
        self.assertEqual(preview['preview']['to'], 'teacher@example.edu')
        self.assertEqual(preview['preview']['subject'], 'Re: Meeting')
        self.assertEqual(preview['preview']['inReplyTo'], '<original@example.edu>')

    def test_oauth2_account_is_detected_but_not_sent_with_password_login(self):
        self.fixture.close()
        self.fixture = ThunderbirdSendFixture(auth_method=10)
        with patch.dict(os.environ, {'THUNDERBIRD_SMTP_PASSWORD': 'secret'}, clear=False):
            status = get_smtp_status(self.fixture.settings())
            self.assertTrue(status['smtp']['oauth2'])
            self.assertFalse(status['smtp']['ready'])
            preview = preview_mail(self.fixture.settings(), {
                'to': 'teacher@example.edu',
                'subject': 'Test',
                'body': 'Hello',
            })
            with self.assertRaises(ThunderbirdSendError) as error:
                send_confirmed_mail(self.fixture.settings(), {
                    'to': 'teacher@example.edu',
                    'subject': 'Test',
                    'body': 'Hello',
                    'confirmationToken': preview['confirmationToken'],
                })
        self.assertEqual(error.exception.code, 'smtp_oauth2_unsupported')


if __name__ == '__main__':
    unittest.main()
