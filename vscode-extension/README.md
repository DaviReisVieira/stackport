# StackPort

**Universal AWS resource browser for local emulators.**

Browse and inspect AWS resources running on [MiniStack](https://github.com/ministackorg/ministack), [LocalStack](https://github.com/localstack/localstack), [Moto](https://github.com/getmoto/moto), or any AWS-compatible endpoint — directly from VS Code.

## Status

> This extension is in **early development**. The current release reserves the StackPort name on the VS Code Marketplace while the full integration is being built.

The main StackPort application is a standalone web tool (Python + React):

```bash
pip install stackport
stackport
# Open http://localhost:8080
```

## Planned Features

- **Sidebar tree view** — services, resource types, and individual resources
- **Quick actions** — invoke Lambda, send SQS messages, browse S3 buckets
- **Auto-discovery** — detect local emulators from `.env` or `docker-compose.yml`
- **Embedded dashboard** — StackPort web UI inside a VS Code webview panel

## Links

- [GitHub Repository](https://github.com/DaviReisVieira/stackport)
- [PyPI Package](https://pypi.org/project/stackport/)
- [Issue Tracker](https://github.com/DaviReisVieira/stackport/issues)

## License

[MIT](https://github.com/DaviReisVieira/stackport/blob/main/LICENSE)
