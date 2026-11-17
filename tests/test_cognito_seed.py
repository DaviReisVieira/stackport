"""Cognito seed summaries count successful creates, not attempts."""

from unittest.mock import MagicMock, patch

import pytest

from scripts.populate_test_data import populate_cognito_idp


@pytest.mark.parametrize("group_fails,client_fails,membership_fails", [
    (False, False, False),
    (True, True, False),
    (False, True, True),
])
def test_seed_counts(group_fails, client_fails, membership_fails, capsys):
    client = MagicMock()
    client.create_user_pool.return_value = {"UserPool": {"Id": "pool-1"}}
    if group_fails:
        client.create_group.side_effect = RuntimeError("group failed")
    if client_fails:
        client.create_user_pool_client.side_effect = RuntimeError("client failed")
    if membership_fails:
        client.admin_add_user_to_group.side_effect = RuntimeError("membership failed")
    with patch("scripts.populate_test_data.get_client", return_value=client), patch(
        "scripts.populate_test_data.random.randint", side_effect=[1, 2]
    ):
        populate_cognito_idp()
    output = capsys.readouterr().out
    assert f"(2 users, {int(not group_fails)} group, {int(not client_fails)} app client)" in output
