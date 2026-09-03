"""Tests for the CloudWatch monitoring routes (#123)."""

import json
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from backend.main import app


@pytest.fixture
def client():
    return TestClient(app)


NOW = datetime(2026, 9, 3, 12, 0, 0, tzinfo=timezone.utc)


class TestDashboards:
    @patch("backend.routes.monitoring.get_client")
    def test_list_dashboards(self, mock_client, client):
        cw = MagicMock()
        cw.list_dashboards.return_value = {
            "DashboardEntries": [{"DashboardName": "app-overview", "LastModified": NOW, "Size": 512}]
        }
        mock_client.return_value = cw

        response = client.get("/api/monitoring/dashboards")
        assert response.status_code == 200
        data = response.json()["dashboards"]
        assert data == [{"name": "app-overview", "lastModified": NOW.isoformat(), "size": 512}]

    @patch("backend.routes.monitoring.get_client")
    def test_get_dashboard_parses_body(self, mock_client, client):
        body = {"widgets": [{"type": "metric", "properties": {"title": "CPU"}}]}
        cw = MagicMock()
        cw.get_dashboard.return_value = {"DashboardBody": json.dumps(body)}
        mock_client.return_value = cw

        response = client.get("/api/monitoring/dashboards/app-overview")
        assert response.status_code == 200
        assert response.json() == {"name": "app-overview", "body": body}
        cw.get_dashboard.assert_called_once_with(DashboardName="app-overview")

    @patch("backend.routes.monitoring.get_client")
    def test_get_dashboard_missing_is_404(self, mock_client, client):
        cw = MagicMock()
        cw.get_dashboard.side_effect = Exception("ResourceNotFound")
        mock_client.return_value = cw

        response = client.get("/api/monitoring/dashboards/nope")
        assert response.status_code == 404


class TestAlarms:
    @patch("backend.routes.monitoring.get_client")
    def test_list_alarms_serialization(self, mock_client, client):
        cw = MagicMock()
        cw.describe_alarms.return_value = {
            "MetricAlarms": [
                {
                    "AlarmName": "high-cpu",
                    "AlarmArn": "arn:aws:cloudwatch:us-east-1:0:alarm:high-cpu",
                    "StateValue": "ALARM",
                    "StateReason": "Threshold crossed",
                    "StateUpdatedTimestamp": NOW,
                    "Namespace": "AWS/EC2",
                    "MetricName": "CPUUtilization",
                    "Statistic": "Average",
                    "Period": 300,
                    "EvaluationPeriods": 1,
                    "Threshold": 80.0,
                    "ComparisonOperator": "GreaterThanThreshold",
                    "Dimensions": [{"Name": "InstanceId", "Value": "i-1"}],
                }
            ]
        }
        mock_client.return_value = cw

        response = client.get("/api/monitoring/alarms")
        assert response.status_code == 200
        alarm = response.json()["alarms"][0]
        assert alarm["name"] == "high-cpu"
        assert alarm["state"] == "ALARM"
        assert alarm["threshold"] == 80.0
        assert alarm["comparisonOperator"] == "GreaterThanThreshold"
        assert alarm["dimensions"] == [{"name": "InstanceId", "value": "i-1"}]


class TestMetricData:
    @patch("backend.routes.monitoring.get_client")
    def test_metric_data_maps_queries_and_series(self, mock_client, client):
        cw = MagicMock()
        cw.get_metric_data.return_value = {
            "MetricDataResults": [
                {"Id": "m1", "Label": "Latency", "Timestamps": [NOW], "Values": [123.4]}
            ]
        }
        mock_client.return_value = cw

        response = client.post(
            "/api/monitoring/metric-data",
            json={
                "queries": [
                    {
                        "id": "m1",
                        "namespace": "Probe/App",
                        "metricName": "Latency",
                        "dimensions": [{"name": "Service", "value": "api"}],
                        "stat": "Average",
                        "period": 60,
                    }
                ],
                "startMinutes": 30,
            },
        )
        assert response.status_code == 200
        result = response.json()["results"][0]
        assert result["id"] == "m1"
        assert result["values"] == [123.4]
        assert result["timestamps"] == [NOW.isoformat()]

        kwargs = cw.get_metric_data.call_args.kwargs
        query = kwargs["MetricDataQueries"][0]
        assert query["Id"] == "m1"
        assert query["MetricStat"]["Metric"]["Namespace"] == "Probe/App"
        assert query["MetricStat"]["Metric"]["Dimensions"] == [{"Name": "Service", "Value": "api"}]
        assert query["MetricStat"]["Stat"] == "Average"
        window = kwargs["EndTime"] - kwargs["StartTime"]
        assert round(window.total_seconds() / 60) == 30

    @patch("backend.routes.monitoring.get_client")
    def test_metric_data_empty_queries(self, mock_client, client):
        response = client.post("/api/monitoring/metric-data", json={"queries": [], "startMinutes": 60})
        assert response.status_code == 200
        assert response.json() == {"results": []}
        mock_client.return_value.get_metric_data.assert_not_called()

    @patch("backend.main.STACKPORT_ALLOW_WRITES", False)
    @patch("backend.routes.monitoring.get_client")
    def test_metric_data_allowed_in_read_only_mode(self, mock_client, client):
        cw = MagicMock()
        cw.get_metric_data.return_value = {"MetricDataResults": []}
        mock_client.return_value = cw

        response = client.post(
            "/api/monitoring/metric-data",
            json={"queries": [{"id": "m1", "namespace": "N", "metricName": "M"}], "startMinutes": 5},
        )
        assert response.status_code == 200
