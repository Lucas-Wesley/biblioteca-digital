.PHONY: dev-api dev-web test test-go test-web test-e2e deploy

dev-api:
	cd backend && DATA_DIR=../data go run .

dev-web:
	cd frontend && npm run dev

test: test-go test-web test-e2e

test-go:
	cd backend && go test ./...

test-web:
	cd frontend && npm test

test-e2e:
	cd frontend && npx playwright test

deploy:
	./deploy.sh
