import { app } from './app';

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => console.log(`Grocery CRM API listening on port ${port}`));
