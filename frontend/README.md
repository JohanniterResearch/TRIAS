# AmbulanzsystemFrontend

This project was generated using [Angular CLI](https://github.com/angular/angular-cli) version 22.0.5.

## Development server

Install the locked dependencies and start the configured development server:

```bash
npm ci
npm start
```

Once the server is running, open your browser and navigate to `http://localhost:4200/`. The application will automatically reload whenever you modify any of the source files.

## Code scaffolding

Angular CLI includes powerful code scaffolding tools. To generate a new component, run:

```bash
ng generate component component-name
```

For a complete list of available schematics (such as `components`, `directives`, or `pipes`), run:

```bash
ng generate --help
```

## Building

To build the production bundle, run:

```bash
npm run build
```

This will compile your project and store the build artifacts in the `dist/` directory. By default, the production build optimizes your application for performance and speed.

## Running unit tests

To execute unit tests with the [Vitest](https://vitest.dev/) test runner, use the following command:

```bash
npm test
```

## Running end-to-end tests

For end-to-end (e2e) testing, run:

```bash
npm run test:e2e
```

The repository uses its configured Vitest/static checks for `npm test` and Playwright for
end-to-end tests. The development server is `http://localhost:4200` and proxies `/api` and
`/hubs` to the backend at `http://localhost:5042`.

## Additional Resources

For more information on using the Angular CLI, including detailed command references, visit the [Angular CLI Overview and Command Reference](https://angular.dev/tools/cli) page.
